/* AEEC — sayt skriptləri: mobil menyu, formalar, layihə filtri, kopyalama */
(function(){
  var LANG=(document.querySelector('[data-site-lang]')||{getAttribute:function(){return 'az';}}).getAttribute('data-site-lang')||'az';
  var MSG={
    az:{bad:'Zəhmət olmasa adı və düzgün e-poçtu daxil edin, razılığı təsdiqləyin.',ok:'Təşəkkür edirik! Bu nümunədir — real saytda sorğu kommersiya komandasına göndəriləcək.',copied:'Kopyalandı: ',lang:' versiyası zip faylındakı saytda mövcuddur.'},
    en:{bad:'Please enter your name and a valid e-mail, and confirm your consent.',ok:'Thank you! This is a demo — on the live site your request will go to the commercial team.',copied:'Copied: ',lang:''},
    ru:{bad:'Пожалуйста, укажите имя и корректный e-mail и подтвердите согласие.',ok:'Спасибо! Это демонстрация — на рабочем сайте запрос будет направлен в коммерческий отдел.',copied:'Скопировано: ',lang:''}
  };
  var T=MSG[LANG]||MSG.az;
  var menuBtn=document.getElementById('menuBtn');
  menuBtn.addEventListener('click',function(){ var n=document.getElementById('nav'); var open=n.classList.toggle('open'); menuBtn.setAttribute('aria-expanded',open?'true':'false'); });

  var toast=document.getElementById('toast'), tt;
  function say(msg){ toast.textContent=msg; toast.hidden=false; clearTimeout(tt); tt=setTimeout(function(){toast.hidden=true;},3200); }

  document.querySelectorAll('.js-form').forEach(function(f){
    f.addEventListener('submit',function(e){
      e.preventDefault();
      var bad=[].slice.call(f.querySelectorAll('[required]')).filter(function(i){return i.type==='checkbox' ? !i.checked : (!i.value.trim() || (i.type==='email' && !/^\S+@\S+\.\S+$/.test(i.value)));});
      if(bad.length){ bad[0].focus(); say(T.bad); return; }
      var ok=document.createElement('p'); ok.className='form-ok full'; ok.setAttribute('role','status');
      /* PROQRAMÇI ÜÇÜN: burada formanı serverə göndərin (fetch/POST). Hazırda yalnız nümunə mesajı göstərilir. */
      ok.textContent=T.ok;
      var old=f.querySelector('.form-ok'); if(old) old.remove();
      f.appendChild(ok); f.reset();
    });
  });

  document.querySelectorAll('.chip').forEach(function(c){
    c.addEventListener('click',function(){
      var f=c.dataset.f;
      document.querySelectorAll('.chip').forEach(function(x){x.setAttribute('aria-pressed',x===c?'true':'false');});
      document.querySelectorAll('#plist .prow').forEach(function(r){ r.hidden = !(f==='all'||r.dataset.f===f); });
    });
  });

  document.querySelectorAll('.copy').forEach(function(b){
    b.addEventListener('click',function(){
      var t=b.dataset.copy;
      try{ navigator.clipboard.writeText(t).then(function(){say(T.copied+t);},function(){say(t);}); }catch(err){ say(t); }
    });
  });
})();
