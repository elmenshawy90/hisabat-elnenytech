const path = require('path');
// Run with npm run test:xss:browser; all HTTP data is mocked, with no database access.
const root = path.join(__dirname, '..');
const puppeteer = require(path.join(root,'node_modules/puppeteer-core'));
const ejs = require(path.join(root,'node_modules/ejs'));
const fs = require('fs');
(async()=>{
const browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page = await browser.newPage();
 const payload = `أحمد <img data-xss src=x onerror="window.__xss=1"> &quot; ' \\`;
 const client={id:1,_id:1,name:payload,clientName:payload,phone:payload,address:payload,notes:payload,balance:50,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),matchedEndClients:[payload]};
 const unit={id:1,name:payload,unitId:1,isBaseUnit:true,conversionRate:1,isActive:true};
 const item={id:1,_id:1,name:payload,notes:payload,units:[unit],baseUnit:unit,currentStock:10,isActive:true};
 const inv={id:1,_id:1,clientId:1,clientName:payload,clientPhone:payload,endClientId:1,endClientName:payload,invoiceCode:'2609-1',type:'purchase',balanceEffect:'increase',amount:50,details:payload,date:new Date().toISOString(),items:[{item,itemUnit:unit,quantity:1,unitPrice:50,lineTotal:50}],services:[{name:payload,price:10}]};
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);
 page.on('request',async req=>{
  const u=new URL(req.url());
  if(u.hostname!=='hisabat.test') return req.respond({status:200,contentType:'application/javascript',body:''});
  if(u.pathname.startsWith('/api/')){
   let data={data:[],pagination:{page:1,total:1,pages:1},stats:{}};
   if(u.pathname==='/api/auth/me')data={authenticated:true,user:{username:'admin',role:'admin'}};
   else if(u.pathname==='/api/clients/1')data={...client,invoices:[inv]};
   else if(u.pathname==='/api/clients')data={...data,data:[client]};
   else if(u.pathname==='/api/items/1')data={...item,stockLogs:[{quantityBase:1,balanceAfter:10,changeType:'restock',notes:payload,supplier:client,createdAt:inv.date}]};
   else if(u.pathname==='/api/suppliers/1/statement')data={supplier:client,balance:50,transactions:[{type:'purchase',amount:50,notes:payload,date:inv.date,runningBalance:50,stockLog:{item,quantityBase:1}}]};
   else if(u.pathname==='/api/items')data={data:[item]};
   else if(u.pathname==='/api/units')data={data:[{...unit,items:[item],itemsCount:1}]};
   else if(u.pathname==='/api/invoices')data={...data,data:[inv]};
   else if(u.pathname==='/api/invoices/1')data=inv;
   else if(u.pathname==='/api/end-clients')data={data:[client]};
   else if(u.pathname==='/api/suppliers')data={...data,data:[{...client,isActive:true}]};
   else if(u.pathname==='/api/dashboard')data={totalClients:1,outstandingBalance:50,todayTransactions:1,lateClients:1,overdueThresholdDays:7,overdueClients:[client],recentTransactions:[inv],topDebtors:[client],chartData:[]};
   else if(u.pathname==='/api/search')data={contractors:[client],endClientMatches:[{endClientName:payload,contractors:[client]}]};
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }
  if(u.pathname.startsWith('/js/'))return req.respond({status:200,contentType:'application/javascript',body:fs.readFileSync(path.join(root,'public',u.pathname),'utf8')});
  if(u.pathname.startsWith('/css/'))return req.respond({status:200,contentType:'text/css',body:fs.readFileSync(path.join(root,'public',u.pathname),'utf8')});
  if(['/dashboard','/clients','/items','/suppliers','/new-invoice','/client-details'].includes(u.pathname)){
   const html=await ejs.renderFile(path.join(root,'views',u.pathname.slice(1)+'.ejs'));
   return req.respond({status:200,contentType:'text/html',body:html});
  }
  return req.respond({status:200,body:''});
 });
 await page.evaluateOnNewDocument(()=>{window.Chart=class{destroy(){}};window.flatpickr=()=>({setDate(){},clear(){}});window.flatpickr.l10ns={ar:{}};});
 for(const name of ['dashboard','clients','items','suppliers','new-invoice','client-details']){
  await page.goto('http://hisabat.test/'+name+'?id=1',{waitUntil:'networkidle0'});
  await page.evaluate(async (name, payload) => {
   if(name==='clients') {
    const button=document.querySelector('button[onclick*="openEditClientModal"]');
    button.click();
    if(!Array.from(document.querySelectorAll('input')).some(el=>el.value===payload)) throw new Error('Client edit did not preserve original name');
   }
   if(name==='items') { renderUnitsTable();openRestockModal(1);await openStockLogModal(1); }
   if(name==='suppliers') await openStatementModal(1);
   if(name==='new-invoice'||name==='client-details') {
    await openTransactionDetails(1);
    const headers=Array.from(document.querySelectorAll('#tdItemsBreakdownContainer th')).map(el=>el.textContent.trim());
    if(headers.join('|')!=='الكمية|الوحدة|الصنف|سعر الوحدة|الإجمالي') throw new Error('Invoice details columns are out of order: '+name);
    if(document.querySelectorAll('#tdItemsBreakdownBody tr').length!==1) throw new Error('Invoice item details are missing: '+name);
    if(document.querySelectorAll('#tdServicesBreakdownBody tr').length!==1) throw new Error('Invoice service details are missing: '+name);
    addServiceRow(payload,10);
   }
  },name,payload);
  const result=await page.evaluate(()=>({injected:!!window.__xss,nodes:document.querySelectorAll('[data-xss]').length,escapedVisible:document.body.textContent.includes('<img data-xss')}));
  console.log(name,JSON.stringify(result));
  if(result.injected||result.nodes||!result.escapedVisible)throw new Error('Unsafe or missing fixture rendering: '+name);
 }
 const helpers=await page.evaluate((payload)=>{
  showToast(payload);showConfirm(payload);
  const div=document.createElement('div');div.innerHTML=highlightArabic(payload,'أحمد <img');document.body.append(div);
  const btn=document.createElement('button');btn.setAttribute('onclick', `window.__selected='${escapeJsString(payload)}'`);btn.click();
  return {nodes:document.querySelectorAll('[data-xss]').length,roundtrip:window.__selected===payload,highlight:div.querySelectorAll('span').length};
 },payload);
 console.log('helpers',JSON.stringify(helpers));
 if(helpers.nodes||!helpers.roundtrip||!helpers.highlight)throw new Error('Helper browser verification failed');
 await page.setViewport({width:390,height:844,deviceScaleFactor:1});
 await page.goto('http://hisabat.test/new-invoice',{waitUntil:'networkidle0'});
 await page.addStyleTag({content:'html,body{margin:0}.fixed{position:fixed}.inset-0{inset:0}.hidden{display:none}.flex{display:flex}.w-full{width:100%}.p-4{padding:1rem}'});
 await page.evaluate(()=>openModal());
 const mobileLayout=await page.evaluate(()=>{
  const panel=document.querySelector('.invoice-modal-panel').getBoundingClientRect();
  const grid=document.querySelector('.invoice-line-grid');
  const fields=[...grid.children].slice(0,5).map(el=>el.querySelector('label')?.textContent.trim());
  const columns=getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const footer=document.querySelector('.invoice-modal-footer').getBoundingClientRect();
  const panelStyle=getComputedStyle(document.querySelector('.invoice-modal-panel'));
  const form=document.querySelector('.invoice-modal-form').getBoundingClientRect();
  return {panelWidth:panel.width,panelHeight:panel.height,panelCssHeight:panelStyle.height,formTop:form.top,formBottom:form.bottom,formHeight:form.height,viewport:innerWidth,viewportHeight:innerHeight,columns,fields,footerPosition:getComputedStyle(document.querySelector('.invoice-modal-footer')).position,footerTop:footer.top,footerBottom:footer.bottom,footerParent:document.querySelector('.invoice-modal-footer').parentElement.className,formChildren:[...document.querySelector('.invoice-modal-form').children].map(x=>x.className||x.id),footerVisible:footer.top<innerHeight&&footer.bottom<=innerHeight+1};
 });
 console.log('mobileLayout',JSON.stringify(mobileLayout));
 if(mobileLayout.panelWidth>mobileLayout.viewport||mobileLayout.columns!==2||!mobileLayout.footerVisible||
    mobileLayout.fields.join('|')!=='الكمية *|الوحدة *|الصنف *|السعر (ج.م) *|الإجمالي') {
   throw new Error('Mobile invoice layout verification failed');
 }
 console.log('pageErrors',JSON.stringify(errors));
 if(errors.length)throw new Error('Browser page errors');
} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
