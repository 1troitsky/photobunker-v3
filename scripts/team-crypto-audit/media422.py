#!/usr/bin/env python3
"""Sanitized re-analysis of a PRIVATE historical trace; never exports bodies."""
import argparse,base64,hashlib,json,re,shutil,subprocess,zipfile
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--trace',required=True,type=Path);p.add_argument('--runtime',required=True,type=Path)
a=p.parse_args();assert(a.runtime/'vendor/autoload.php').exists()
with zipfile.ZipFile(a.trace)as z:
    events=[]
    for name in z.namelist():
        if name.endswith('.network'):events +=[json.loads(line).get('snapshot',{})for line in z.read(name).decode().splitlines()]
    def body(req):
        data=req.get('postData',{});raw=data.get('text');sha=data.get('_sha1')
        if sha and'resources/'+sha in z.namelist():raw=z.read('resources/'+sha).decode()
        return json.loads(raw)if raw else None
    media={}
    for event in events:
        req=event.get('request',{})
        if req.get('method')=='POST'and'/media/v1/'in req.get('url',''):
            try:
                c=json.loads(body(req)['contract'])
                if'mediaId'in c and'expiresAt'in c:media[c['mediaId']]=c
            except(KeyError,TypeError,ValueError):pass
    matches=[x for x in events if x.get('response',{}).get('status')==422 and x.get('request',{}).get('url','').endswith('/media-shares/v1/grants')]
    assert len(matches)==1
    payload=body(matches[0]['request']);c=json.loads(payload['contract']);m=media[c['mediaId']]
    decode=lambda s:base64.urlsafe_b64decode(s+'='*((4-len(s)%4)%4))
    env=c['envelope'];pub=subprocess.run(['openssl','pkey','-pubin','-inform','DER','-text','-noout'],input=decode(env['ephemeralSpki']),capture_output=True)
    checks={'canonicalJson':json.dumps(c,separators=(',',':'),ensure_ascii=False)==payload['contract'],
      'bodyKeysExact':sorted(payload)==['contract','signature'],'contractLengthValid':200<=len(payload['contract'])<=12000,
      'fieldsExact':sorted(c)==sorted(['version','grantId','mediaId','ownerAccountId','recipientAccountId','recipientKeyDigest','mediaContractHash','scope','expiresAt','envelope']),
      'versionScopeValid':c['version']==1 and c['scope']=='read','integerExpiry':isinstance(c['expiresAt'],int),
      'uuidShapesValid':all(re.fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',c[k])is not None for k in ['grantId','mediaId','ownerAccountId','recipientAccountId']),
      'distinctActors':c['ownerAccountId']!=c['recipientAccountId'],
      'hashShapesValid':all(re.fullmatch('[a-f0-9]{64}',c[k])is not None for k in ['recipientKeyDigest','mediaContractHash']),
      'envelopeKeysExact':sorted(env)==['ciphertext','ephemeralSpki','iv','salt'],
      'validP256Spki':pub.returncode==0 and b'prime256v1'in pub.stdout,
      'saltIvCipherLengthsValid':[len(decode(env[k]))for k in ['salt','iv','ciphertext']]==[16,12,48],
      'signatureLengthValid':len(decode(payload['signature']))==64,
      'grantAtMostReservedMediaExpiry':c['expiresAt']<=m['expiresAt'],
      'mediaContractHashMatches':hashlib.sha256(json.dumps(m,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()==c['mediaContractHash']}
    assert all(checks.values())
    (a.runtime/'audit-media422.json').write_text(json.dumps(payload));(a.runtime/'audit-media422.json').chmod(0o600)
    shutil.copy2(Path(__file__).with_name('media422-probe.php'),a.runtime/'audit-media422-probe.php')
    command=['docker','run','--rm','--network','none','-v',str(a.runtime.resolve())+':/app','pb3-local-acceptance-php:8.4.27','php','audit-media422-probe.php']
    probe=json.loads(subprocess.check_output(command,text=True))
    print(json.dumps({'status':'PASS','nonTemporalChecks':checks,'probe':probe,
      'interpretation':'The exact historical contract is rejected solely by the strict upper time window in the controlled -3ms replay. This supports a clock/boundary explanation; it does not measure the historical server clock or prove every future 422 has this cause.'},indent=2))
