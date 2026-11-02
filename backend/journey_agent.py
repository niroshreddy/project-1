"""Python/Playwright recovery investigator. No generated code, customer session, or production writes."""
import asyncio
import base64
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit
from backend.journey_models import validate_target, LocalPlan
from backend import journey_ai

class Cancelled(Exception): pass

def now(): return datetime.now(timezone.utc).isoformat()

def browser_options():
    executable=os.getenv('JOURNEY_BROWSER_EXECUTABLE','')
    if executable: return {'executable_path':executable}
    if sys.platform=='win32':
        from pathlib import Path
        edge=Path(os.getenv('PROGRAMFILES(X86)','C:/Program Files (x86)'))/'Microsoft/Edge/Application/msedge.exe'
        if edge.is_file(): return {'executable_path':str(edge)}
    return {}

DISCOVER_JS = r'''form => {
 const labelText=el=>{const label=el.labels?.[0]?.cloneNode(true);label?.querySelectorAll('input,select,textarea').forEach(control=>control.remove());return label?.textContent||el.getAttribute('aria-label')||el.name||el.id||'';};
 const selector=el=>el.id?'#'+CSS.escape(el.id):el.name?'[name='+JSON.stringify(el.name)+']':null;
 const fields=[...form.querySelectorAll('input,textarea,select')].filter(el=>!['hidden','password','file','submit','button','checkbox','radio'].includes(el.type)&&!el.disabled).map(el=>({
 selector:selector(el),kind:el.tagName==='SELECT'?'select':el.type||'text',autocomplete:el.autocomplete||'',required:el.required,
 label:labelText(el).trim().slice(0,100),
 options:el.tagName==='SELECT'?[...el.options].slice(0,30).map(item=>({value:item.value,label:item.text.slice(0,80)})):[]
 })).filter(el=>el.selector);
 const buttons=[...form.querySelectorAll('button,input[type=submit]')].map(el=>({selector:selector(el)||(el.tagName==='BUTTON'?'button[type="submit"]':'input[type="submit"]'),text:(el.textContent||el.value||'').trim().slice(0,100),type:el.type}));
 return {fields,buttons,sensitive:!!form.querySelector('input[type=password],input[autocomplete^="cc-"]'),title:document.title.slice(0,120)};
}'''

def browser_available():
    from pathlib import Path
    options=browser_options()
    if options.get('executable_path'):return Path(options['executable_path']).is_file()
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:return Path(playwright.chromium.executable_path).is_file()
    except Exception:return False

async def launch(playwright):
    return await playwright.chromium.launch(headless=True,**browser_options())

async def guarded_context(browser,url,size,write_paths=()):
    approved=validate_target(url)
    context=await browser.new_context(viewport=size,locale='en-US',service_workers='block',accept_downloads=False)
    blocked=[]
    async def route_handler(route):
        request=route.request;parsed=urlsplit(request.url)
        request_origin=f'{parsed.scheme}://{parsed.netloc.lower()}'
        sensitive=re.search(r'(payment|purchase|charge|place[-_]?order|complete[-_]?order|submit[-_]?order)',parsed.path,re.I)
        writing=request.method not in ('GET','HEAD','OPTIONS')
        reason=None
        if request.method not in ('GET','HEAD','OPTIONS','POST','PUT','PATCH'): reason='Destructive/unsupported HTTP method'
        elif request_origin!=approved: reason='Outside the approved staging origin'
        elif sensitive: reason='Payment/order action boundary'
        elif writing and parsed.path not in write_paths: reason='Write path was not explicitly allowed'
        elif writing and re.search(r'(placeOrder|createOrder|creditCard|cardNumber|paymentToken|purchase|charge)',request.post_data or '',re.I): reason='Payment/order payload boundary'
        if reason:
            blocked.append({'method':request.method,'path':parsed.path[:200],'resource':request.resource_type,'reason':reason})
            await route.abort()
        else: await route.continue_()
    await context.route('**/*',route_handler)
    async def websocket_handler(socket):
        blocked.append({'method':'WS','path':'[websocket]','resource':'websocket','reason':'WebSocket writes are outside the address-form MVP'})
        await socket.close(code=1008,reason='Journey address-form boundary')
    await context.route_web_socket('**/*',websocket_handler)
    page=await context.new_page()
    page.set_default_timeout(6000)
    await page.goto(url,wait_until='domcontentloaded',timeout=15000)
    await page.evaluate('''async()=>{await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,1000))]);}''')
    return context,page,blocked

async def form_info(page,selector):
    form=page.locator(selector)
    if await form.count()!=1: raise ValueError('Form selector must match exactly one form. Specify its unique CSS selector.')
    if await form.evaluate("el=>el.tagName!=='FORM'"): raise ValueError('Select an actual address <form> element.')
    data=await form.evaluate(DISCOVER_JS)
    if data['sensitive']: raise ValueError('This form includes password or payment fields. Use a dedicated staging address form.')
    if len(data['fields'])>20: raise ValueError('This form has too many controls for the address-recovery MVP.')
    return form,data

async def discover(request):
    from playwright.async_api import async_playwright
    async with async_playwright() as playwright:
        browser=await launch(playwright)
        try:
            context,page,blocked=await guarded_context(browser,request.url,{'width':1280,'height':800})
            try:
                _,data=await form_info(page,request.formSelector)
                return {**data,'url':request.url,'blockedRequests':blocked[:20]}
            finally: await context.close()
        finally: await browser.close()

async def unique(root,selector):
    locator=root.locator(selector)
    if await locator.count()!=1: raise ValueError(f'Selector must match exactly one control: {selector}')
    return locator

async def fill_control(control,value):
    kind=await control.evaluate("el=>({tag:el.tagName,type:el.type,autocomplete:el.autocomplete||''})")
    if kind['type'] in ('password','file','hidden') or kind['autocomplete'].startswith('cc-'): raise ValueError('Sensitive or hidden controls cannot be filled by this agent.')
    if kind['tag']=='SELECT': await control.select_option(value)
    else: await control.fill(value)

async def snapshot(page,form,postal,error_selector,expected,success_selector):
    values={}
    for field in expected:
        control=await unique(form,field.selector)
        values[field.selector]=await control.input_value()
    postal_state=await postal.evaluate(r'''el=>({invalid:el.getAttribute('aria-invalid')==='true'||!el.validity.valid,nativeMessage:el.validationMessage||'',focused:el===document.activeElement,id:el.id,described:[el.getAttribute('aria-describedby'),el.getAttribute('aria-errormessage')].filter(Boolean).join(' ').split(/\s+/)})''')
    errors=[]
    for locator in (await page.locator(error_selector).all())[:20]:
        if not await locator.is_visible(): continue
        text=(await locator.inner_text()).strip()[:400]
        if not text: continue
        info=await locator.evaluate('''el=>{const rect=el.getBoundingClientRect();return {id:el.id,inViewport:rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth,linked:[...el.querySelectorAll('a[href]')].map(a=>a.getAttribute('href'))}}''')
        errors.append({**info,'text':text})
    success=page.locator(success_selector)
    successful=await success.count()==1 and await success.is_visible()
    active=await page.evaluate("()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id||'',label:(document.activeElement?.getAttribute('aria-label')||'').slice(0,100)})")
    return {'values':values,'postal':postal_state,'errors':errors,'success':successful,'focus':active,'url':page.url}

async def screenshot(page):
    # Independent context, synthetic data only. Mask any password/payment inputs injected later.
    return 'data:image/png;base64,'+base64.b64encode(await page.screenshot(type='png',full_page=False,animations='disabled',mask=[page.locator('input[type=password],input[autocomplete^="cc-"]')])).decode()

async def settle(page,cancel):
    for _ in range(8):
        if cancel.is_set(): raise Cancelled()
        await page.wait_for_timeout(125)

async def keyboard_reaches(page,target,max_tabs=35):
    await page.evaluate("()=>{document.activeElement?.blur();document.body.setAttribute('data-journey-original-tabindex',document.body.getAttribute('tabindex')??'');document.body.tabIndex=-1;document.body.focus();}")
    reached=False
    try:
        for _ in range(max_tabs):
            await page.keyboard.press('Tab')
            if await target.evaluate('el=>el===document.activeElement'): reached=True;break
    finally:
        await page.evaluate("()=>{const original=document.body.getAttribute('data-journey-original-tabindex');if(original)document.body.setAttribute('tabindex',original);else document.body.removeAttribute('tabindex');document.body.removeAttribute('data-journey-original-tabindex');}")
    return reached

RECOMMENDATIONS={
 'data-loss':'Preserve untouched address values when validation fails. Clear only information the user explicitly removes.',
 'missing-feedback':'Show a specific validation message explaining how to correct the postal code.',
 'feedback-offscreen':'Keep error feedback visible or move focus to the affected field/error summary without losing context.',
 'unassociated-error':'Associate the postal error with the field using its native validity, aria-describedby/aria-errormessage, or an error-summary link.',
 'keyboard-unreachable':'Keep the postal field in the keyboard focus order and avoid trapping focus.',
 'recovery-incomplete':'Check that correcting the postal code allows the address step to reach the declared success state.'
}

async def attempt(browser,contract,scenario,size,repeat,cancel):
    context,page,blocked=await guarded_context(browser,contract.url,size.model_dump(),contract.allowedWritePaths)
    actions=[]
    def log(text): actions.append({'at':now(),'action':text})
    try:
        form,_=await form_info(page,contract.formSelector)
        postal=await unique(form,contract.postalSelector)
        submit=await unique(form,contract.submitSelector)
        name=await submit.evaluate("el=>(el.textContent||el.value||'').trim()")
        if re.search(r'(pay\b|purchase|place\s+order|complete\s+order|buy\s+now)',name,re.I): raise ValueError('The selected button may finalize payment or an order. Select the address-step Continue button.')
        if await page.locator(contract.successSelector).count()>1: raise ValueError('Success selector is ambiguous.')
        if await page.locator(contract.successSelector).count()==1 and await page.locator(contract.successSelector).is_visible(): raise ValueError('The success marker is already visible before the task starts. Use a marker for the next shipping state.')
        checks=[]
        keyboard=not scenario.startswith('keyboard') or await keyboard_reaches(page,postal)
        if scenario.startswith('keyboard'):
            checks.append({'code':'keyboard-unreachable','passed':keyboard,'detail':'Postal field reachable by Tab within 35 steps.' if keyboard else 'Postal field was not reachable by Tab within the configured 35-step bound.'})
            log('Check keyboard reachability of the postal field.')
        for field in contract.fields:
            await fill_control(await unique(form,field.selector),field.value)
        await fill_control(postal,contract.validPostal)
        before=await snapshot(page,form,postal,contract.errorSelector,contract.fields,contract.successSelector)
        if repeat==1: initial_image=await screenshot(page)
        else: initial_image=None
        invalid='' if scenario=='empty-postal' else contract.invalidPostal
        await fill_control(postal,invalid)
        if scenario.startswith('keyboard'):
            await postal.focus();await page.keyboard.press('Enter');log('Submit invalid postal code using Enter from postal field.')
        else: await submit.click();log('Submit the declared invalid/empty postal code through address Continue.')
        await settle(page,cancel)
        invalid_state=await snapshot(page,form,postal,contract.errorSelector,contract.fields,contract.successSelector)
        blocked_write=any(item['method'] not in ('GET','HEAD','OPTIONS') or item['resource']=='document' for item in blocked)
        if invalid_state['success']:
            return {'scenario':scenario,'viewport':size.model_dump(),'repeat':repeat,'status':'inconclusive','reason':'The declared invalid postal code reached the success state. Confirm the invalid test input and expected validation requirement before evaluating recovery.','actions':actions,'blockedRequests':blocked[:20],'checks':[]}
        if blocked_write:
            return {'scenario':scenario,'viewport':size.model_dump(),'repeat':repeat,'status':'inconclusive','reason':'The action/network boundary blocked a submission or navigation. Configure the exact staging validation write path; this is not a usability defect.','actions':actions,'blockedRequests':blocked[:20],'checks':[]}
        lost=[field.label or field.selector for field in contract.fields if field.selector!=contract.postalSelector and invalid_state['values'].get(field.selector)!=before['values'].get(field.selector)]
        feedback=bool(invalid_state['errors'] or invalid_state['postal']['nativeMessage'])
        visible_feedback=bool(invalid_state['postal']['nativeMessage']) or any(error['inViewport'] for error in invalid_state['errors'])
        association=bool(invalid_state['postal']['nativeMessage']) or any(error['id'] in invalid_state['postal']['described'] or '#'+invalid_state['postal']['id'] in error['linked'] for error in invalid_state['errors'] if error['id'] or invalid_state['postal']['id'])
        checks += [
          {'code':'data-loss','passed':not lost,'detail':'Untouched address values were preserved.' if not lost else 'Changed/cleared fields: '+', '.join(lost)},
          {'code':'missing-feedback','passed':feedback,'detail':'Validation feedback was detected.' if feedback else 'No native validation message or visible configured error text was detected.'},
          {'code':'feedback-offscreen','passed':visible_feedback,'detail':'At least one validation message is in the viewport/native feedback.' if visible_feedback else 'Validation feedback is outside the visible viewport or absent.'},
          {'code':'unassociated-error','passed':association,'detail':'A detectable field/error association exists.' if association else 'No native validation or configured field/error association was found.'}
        ]
        invalid_image=await screenshot(page) if repeat==1 else None
        await fill_control(postal,contract.validPostal)
        if scenario.startswith('keyboard'): await postal.focus();await page.keyboard.press('Enter')
        else: await submit.click()
        log('Correct only the postal code, preserving the original untouched fields, and submit again.')
        await settle(page,cancel)
        # Read success separately because a successful step may remove the form.
        success_locator=page.locator(contract.successSelector)
        success=await success_locator.count()==1 and await success_locator.is_visible()
        if any(item['method'] not in ('GET','HEAD','OPTIONS') or item['resource']=='document' for item in blocked):
            return {'scenario':scenario,'viewport':size.model_dump(),'repeat':repeat,'status':'inconclusive','reason':'Recovery submission/navigation was blocked by the action boundary.','checks':checks,'actions':actions,'blockedRequests':blocked[:20]}
        checks.append({'code':'recovery-incomplete','passed':success,'detail':'Declared shipping success marker became visible.' if success else 'Declared success marker did not become visible after correcting only the postal code.'})
        recovery_image=await screenshot(page) if repeat==1 else None
        return {'scenario':scenario,'viewport':size.model_dump(),'repeat':repeat,'status':'completed','checks':checks,'focusAfterInvalid':invalid_state['focus'],
          'errorText':[error['text'] for error in invalid_state['errors']],'nativeValidation':invalid_state['postal']['nativeMessage'],'actions':actions,'blockedRequests':blocked[:20],
          'evidence':{'before':initial_image,'invalid':invalid_image,'recovery':recovery_image} if repeat==1 else {}}
    finally: await context.close()

async def investigate(contract,cancel,progress,frozen_plan=None):
    from playwright.async_api import async_playwright
    validate_target(contract.url)
    if cancel.is_set(): raise Cancelled()
    discovery=await discover(contract)
    if cancel.is_set(): raise Cancelled()
    if frozen_plan:
        plan=LocalPlan.model_validate(frozen_plan);planner='baseline-replay'
    elif contract.useLocalAI:
        progress('Asking the local model to prioritize bounded recovery checks…')
        plan=await journey_ai.plan(contract,discovery['fields']);planner='local-ollama'
    else:
        plan=LocalPlan(scenarios=['invalid-postal','keyboard-invalid-postal','empty-postal'],rationale='Built-in bounded checks: invalid postal code, keyboard submission, and empty postal recovery. This is not AI analysis.');planner='built-in'
    results=[]
    async with async_playwright() as playwright:
        browser=await launch(playwright)
        try:
            total=len(plan.scenarios)*len(contract.viewports)*contract.repeats
            for size in contract.viewports:
                for scenario in plan.scenarios:
                    for repeat in range(1,contract.repeats+1):
                        if cancel.is_set(): raise Cancelled()
                        progress(f'{len(results)+1}/{total}: {scenario}, {size.width}px, repetition {repeat}')
                        try: result=await attempt(browser,contract,scenario,size,repeat,cancel)
                        except Cancelled: raise
                        except Exception as error:
                            result={'scenario':scenario,'viewport':size.model_dump(),'repeat':repeat,'status':'inconclusive','reason':str(error)[:500],'checks':[]}
                        results.append(result)
                        progress(f'Completed {len(results)}/{total} attempts',results)
        finally: await browser.close()
    findings=[]
    for size in contract.viewports:
        for scenario in plan.scenarios:
            cases=[case for case in results if case['scenario']==scenario and case['viewport']==size.model_dump()]
            for code in RECOMMENDATIONS:
                failures=[case for case in cases if case['status']=='completed' and any(check['code']==code and not check['passed'] for check in case['checks'])]
                if not failures: continue
                first=failures[0]
                findings.append({'key':f'{size.width}x{size.height}:{scenario}:{code}','code':code,'scenario':scenario,'viewport':size.model_dump(),
                  'evidenceLevel':'reproduced' if len(failures)>=2 else 'observed','reproductions':len(failures),'attempts':len(cases),
                  'detail':next(check['detail'] for check in first['checks'] if check['code']==code),'recommendation':RECOMMENDATIONS[code]})
    return {'contract':contract.model_dump(),'plan':plan.model_dump(),'planner':planner,'model':contract.model if planner=='local-ollama' else None,'attempts':results,'findings':findings,
      'summary':f'{len(findings)} observed/reproduced recovery findings across {len(results)} attempts. '+('Some attempts were inconclusive; inspect their reasons.' if any(case['status']!='completed' for case in results) else 'All attempts completed.'),
      'limitations':['Automated recovery checks are not a study of real customer behavior.','Focus/field associations are DOM evidence, not a complete accessibility or screen-reader evaluation.','No production changes, payment actions, or final orders are performed.','Success is evaluated only against the declared shipping success selector.'], 'completedAt':now()}
