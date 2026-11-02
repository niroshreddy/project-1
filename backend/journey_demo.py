"""Synthetic checkout fixture. No payments, accounts, emails or external requests."""
def checkout_html(variant='buggy'):
    fixed=variant=='fixed'
    return '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Journey Agent synthetic checkout</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f2ec;color:#173c4e;font:16px/1.5 system-ui}header{padding:22px;background:#173c4e;color:white}main{max-width:650px;margin:24px auto;padding:20px;background:white;border-radius:12px}label{display:block;margin:16px 0}input,select{display:block;width:100%;padding:12px;font:inherit;border:1px solid #acb7bb;border-radius:5px}button{padding:14px 24px;background:#507f8c;color:white;font:inherit;border:0;border-radius:5px}.error{color:#a51e36;background:#fff0f2;padding:12px}.note{font-size:13px}#success{padding:24px;background:#e0f5eb}form{padding-bottom:24px}</style></head><body><header>Demo store · Address recovery test</header><main><h1>Shipping address</h1><p class="note">Synthetic local fixture. No real orders or payments. Variant: VARIANT.</p><div id="error" class="error" role="alert" hidden></div><form id="address-form" novalidate><label>Full name<input id="full-name" name="fullName" autocomplete="name" required></label><label>Street address<input id="street" name="street" autocomplete="address-line1" required></label><label>City<input id="city" name="city" autocomplete="address-level2" required></label><label>State<input id="state" name="state" autocomplete="address-level1" required></label><label>Postal code<input id="postal" name="postal" autocomplete="postal-code" inputmode="numeric" required></label><label>Country<select id="country" autocomplete="country"><option value="US">United States</option></select></label><button id="continue" type="submit">Continue to shipping</button></form><div id="success" data-journey-success hidden><h2>Shipping options</h2><p>Address accepted. Choose a shipping method next.</p></div></main><script>
const fixed=FIXED;
const form=document.querySelector('form'),postal=document.querySelector('#postal'),error=document.querySelector('#error');
form.addEventListener('submit',event=>{event.preventDefault();
 if(!/^\\d{5}$/.test(postal.value)){
  error.hidden=false;error.textContent='Enter a five-digit postal code.';
  if(fixed){postal.setAttribute('aria-invalid','true');postal.setAttribute('aria-describedby','error');postal.focus();}
  else{form.reset();error.style.position='absolute';error.style.top='0';error.style.left='0';}
  return;
 }
 if(['#full-name','#street','#city','#state'].some(selector=>!document.querySelector(selector).value.trim())){error.hidden=false;error.textContent='Complete your address again.';return;}
 postal.removeAttribute('aria-invalid');error.hidden=true;document.querySelector('#success').hidden=false;form.hidden=true;
});
</script></body></html>'''.replace('VARIANT',variant).replace('FIXED','true' if fixed else 'false')
