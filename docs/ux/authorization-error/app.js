
(()=>{'use strict';
const scenarios={
  key:{title:'Вход с этим ключом невозможен',description:'Ключ аккаунта недействителен, повреждён или не подходит для входа. Проверьте, что используете правильный Recovery Key.'},
  lost:{title:'Ключ аккаунта утрачен',description:'Ключ входа отсутствует на этом устройстве. Если у вас сохранилась копия Recovery Key, используйте её для восстановления доступа.'},
  deleted:{title:'Аккаунт больше недоступен',description:'Аккаунт был удалён. Войти в него с прежним ключом больше нельзя.'},
  device:{title:'Доступ с устройства закрыт',description:'Это устройство было отключено от аккаунта. Доступ с него прекращён.'},
  emergency:{title:'Доступ к аккаунту прекращён',description:'Был использован PIN экстренного удаления. Доступ с этого устройства заблокирован; возможность восстановления зависит от состояния аккаунта и резервных копий.'},
  local:{title:'Данные входа недоступны',description:'Не удалось прочитать данные авторизации на этом устройстве. Они могли быть удалены или повреждены. Попробуйте восстановить доступ с сохранённым ключом.'}
};
const select=document.getElementById('error-type');
select.addEventListener('change',()=>{const reason=scenarios[select.value];if(!reason)return;document.getElementById('error-title').textContent=reason.title;document.getElementById('error-description').textContent=reason.description});
document.querySelectorAll('[data-device]').forEach(button=>button.addEventListener('click',()=>{document.getElementById('device').className='device '+button.dataset.device;document.querySelectorAll('[data-device]').forEach(el=>{el.classList.toggle('selected',el===button);el.setAttribute('aria-pressed',String(el===button))})}));
})();
