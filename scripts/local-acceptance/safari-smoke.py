#!/usr/bin/env python3
"""Probe installed Safari using native WebDriver; never enable OS permissions."""
import base64
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request


def main():
    driver = shutil.which('safaridriver')
    if not driver:
        print('NOT TESTED: native safaridriver is not installed; WebKit is not Safari.')
        return 77
    directory = Path(sys.argv[1])
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    session_id = None
    def request(method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(origin + path, data=data, method=method,
                                     headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                value = json.load(response)['value']
        except urllib.error.HTTPError as error:
            detail = error.read().decode()
            raise RuntimeError(detail) from error
        return value
    with (directory / 'safaridriver.log').open('w') as output:
        process = subprocess.Popen([driver, '-p', str(port)], stdout=output, stderr=subprocess.STDOUT)
    try:
        for attempt in range(20):
            try:
                request('GET', '/status')
                break
            except (OSError, RuntimeError):
                if process.poll() is not None:
                    print('NOT TESTED: safaridriver exited; inspect safaridriver.log.')
                    return 77
                time.sleep(0.25)
        try:
            session = request('POST', '/session', {'capabilities': {'alwaysMatch': {'browserName': 'safari'}}})
        except RuntimeError as error:
            message = str(error)
            if any(part in message.lower() for part in ('allow remote automation', 'not authorized', 'enable remote automation')):
                print('NOT TESTED: Safari remote automation is disabled. ' + message)
                return 77
            raise
        session_id = session['sessionId']
        prefix = '/session/' + session_id
        request('POST', prefix + '/url', {'url': 'http://127.0.0.1:5173/settings'})
        for attempt in range(30):
            text = request('POST', prefix + '/execute/sync', {'script': 'return document.body.innerText', 'args': []})
            if 'Настройки / Доступ' in text:
                break
            time.sleep(0.25)
        else:
            raise RuntimeError('Safari did not render account page')
        result = request('POST', prefix + '/execute/async', {'args': [], 'script': '''
const done=arguments[arguments.length-1];
(async()=>{
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pb3-acceptance-safari-probe',1);
 r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 await new Promise((resolve,reject)=>{const t=db.transaction('keys','readwrite');t.objectStore('keys').put(key,'key');
 t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
 const restored=await new Promise((resolve,reject)=>{const r=db.transaction('keys').objectStore('keys').get('key');
 r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 const iv=crypto.getRandomValues(new Uint8Array(12)),plain=new TextEncoder().encode('synthetic acceptance bytes');
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},restored,plain);
 const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv},restored,encrypted);
 db.close();indexedDB.deleteDatabase('pb3-acceptance-safari-probe');
 done({ok:new TextDecoder().decode(clear)==='synthetic acceptance bytes',extractable:restored.extractable});
})().catch(e=>done({error:e.name+': '+e.message}));
'''})
        if result != {'ok': True, 'extractable': False}:
            raise RuntimeError('Safari IndexedDB/WebCrypto probe failed: ' + json.dumps(result))
        request('POST', prefix + '/window/rect', {'width': 390, 'height': 844})
        screenshot = request('GET', prefix + '/screenshot')
        (directory / 'safari-settings.png').write_bytes(base64.b64decode(screenshot))
        print(json.dumps({'status': 'PASS', 'capabilities': session['capabilities'], 'indexedDBWebCrypto': result}))
        return 0
    except Exception as error:
        print('FAIL: ' + str(error))
        return 1
    finally:
        if session_id:
            try:
                request('DELETE', '/session/' + session_id)
            except Exception:
                pass
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == '__main__':
    raise SystemExit(main())
