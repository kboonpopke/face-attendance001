'use strict';
const $=id=>document.getElementById(id);
const state={ready:false,models:false,stream:null,scanning:false,busy:false,lastId:'',lastAt:0,admin:false,pending:new Map(),seq:0};
const text=(id,value)=>{$(id).textContent=String(value??'');};
const status=(message,kind='warn',admin=false)=>{const e=$(admin?'adminStatus':'scanStatus');e.textContent=message;e.className='status '+kind;};
const val=id=>$(id).value.trim();
function uuid(){return crypto.randomUUID().replaceAll('-','_');}
function setupBridge(){
  if(!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(window.FA_BRIDGE_URL||'')){status('ตั้งค่า FA_BRIDGE_URL ใน config.js ก่อน','error');return;}
  window.addEventListener('message',ev=>{
    if(ev.source!==$('bridge').contentWindow)return;
    const d=ev.data;if(!d||typeof d!=='object')return;
    if(d.type==='FA_BRIDGE_READY'){state.ready=true;status('เชื่อมต่อ Apps Script แล้ว · พร้อมเปิดกล้อง','ok');return;}
    if(d.type==='FA_RESPONSE'){
      const pending=state.pending.get(d.id);if(!pending)return;
      clearTimeout(pending.timer);state.pending.delete(d.id);
      d.ok?pending.resolve(d.result):pending.reject(new Error(d.error||'API error'));
    }
  });
  $('bridge').src=window.FA_BRIDGE_URL;
}
function api(action,data={},admin=false){
  if(!state.ready)return Promise.reject(new Error('API Bridge ยังไม่พร้อม โปรดตรวจ URL / Deployment / Origin'));
  const secret=val(admin?'adminSecret':'scannerSecret');if(!secret)return Promise.reject(new Error('กรุณากรอกรหัส '+(admin?'Admin':'Scanner')));
  const id='r'+(++state.seq)+'_'+Date.now();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{state.pending.delete(id);reject(new Error('API timeout 45 วินาที'))},45000);
    state.pending.set(id,{resolve,reject,timer});
    $('bridge').contentWindow.postMessage({type:'FA_REQUEST',id,payload:{action,...data,secret}},'*');
  });
}
async function models(){
  if(state.models)return;
  status('กำลังโหลดโมเดล AI...');
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(window.FA_MODEL_URL),
    faceapi.nets.ssdMobilenetv1.loadFromUri(window.FA_MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(window.FA_MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(window.FA_MODEL_URL)
  ]);
  state.models=true;
}
async function start(){
  if(state.scanning)return;
  try{
    if(!val('scannerSecret'))throw new Error('กรุณากรอก Scanner secret');
    await models();
    state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:720},height:{ideal:960}},audio:false});
    $('video').srcObject=state.stream;await $('video').play();state.scanning=true;
    status('กำลังสแกนใบหน้า','ok');loop();
  }catch(err){status('เปิดกล้องไม่สำเร็จ: '+err.message,'error');stop();}
}
function stop(){state.scanning=false;if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;}$('video').srcObject=null;}
async function loop(){
  if(!state.scanning)return;
  if(state.busy){setTimeout(loop,450);return;}
  state.busy=true;
  try{
    if($('video').readyState>=2){
      const d=await faceapi.detectSingleFace($('video'),new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:0.5})).withFaceLandmarks().withFaceDescriptor();
      if(d){
        const now=Date.now();
        if(now-state.lastAt>10000){
          state.lastAt=now;
          status('พบใบหน้า กำลังยืนยันกับเซิร์ฟเวอร์...');
          const result=await api('scan',{requestId:uuid(),deviceId:val('deviceId')||'SCANNER-CNX-01',descriptor:Array.from(d.descriptor)});
          if(result.employeeId){text('personName',result.name);text('personMeta',result.employeeId+' · '+(result.company||''));}
          text('scanAction',result.action||result.code||'REJECTED');
          text('scanDistance','Verified by server');
          if(result.success){status('บันทึก '+result.action+' สำเร็จ · '+new Date(result.timestamp).toLocaleString('th-TH'),'ok');if(navigator.vibrate)navigator.vibrate(100);}
          else status(result.message||result.code||'ไม่อนุญาตลงเวลา','warn');
        }
      }
    }
  }catch(err){status('สแกนไม่สำเร็จ: '+err.message,'error');}
  finally{state.busy=false;if(state.scanning)setTimeout(loop,600);}
}
async function extract(file,label){
  if(!file)throw new Error('ยังไม่มีรูป '+label);
  const image=await faceapi.bufferToImage(file);
  const d=await faceapi.detectSingleFace(image,new faceapi.SsdMobilenetv1Options({minConfidence:0.5})).withFaceLandmarks().withFaceDescriptor();
  if(!d)throw new Error('ไม่พบใบหน้าในรูป '+label);
  return Array.from(d.descriptor);
}
function showAdmin(){stop();$('scanner').classList.add('hidden');$('admin').classList.remove('hidden');}
function showScanner(){$('admin').classList.add('hidden');$('scanner').classList.remove('hidden');}
async function runAdmin(action,data={},onSuccess=()=>{}){
  try{status('กำลังประมวลผล...','warn',true);const r=await api(action,data,true);if(!r.success)throw new Error(r.message||r.code||'ไม่สำเร็จ');status('สำเร็จ','ok',true);onSuccess(r);return r;}
  catch(e){status(e.message,'error',true);return null;}
}
function itemList(id,rows,fn){const el=$(id);el.replaceChildren();if(!rows.length){el.textContent='ไม่มีรายการ';return;}rows.forEach(r=>{const div=document.createElement('div');div.className='item';div.textContent=fn(r);el.appendChild(div);});}
function setTab(tab){['employees','enroll','schedule','review'].forEach(t=>$('tab-'+t).classList.toggle('hidden',t!==tab));}
function bind(){
  $('startBtn').onclick=start;$('stopBtn').onclick=()=>{stop();status('หยุดกล้องแล้ว');};
  $('adminToggle').onclick=()=>{$('admin').classList.contains('hidden')?showAdmin():showScanner();};
  $('adminLogin').onclick=()=>runAdmin('employees',{},r=>{state.admin=true;$('adminTools').classList.remove('hidden');itemList('employeeList',r.employees,e=>`${e.employeeId} · ${e.name} · ${e.company} · ${e.status}`);});
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
  $('saveEmployee').onclick=()=>runAdmin('saveEmployee',{employeeId:val('empId'),name:val('empName'),company:val('empCompany'),department:val('empDepartment'),position:val('empPosition'),status:val('empStatus')});
  $('refreshEmployees').onclick=()=>runAdmin('employees',{},r=>itemList('employeeList',r.employees,e=>`${e.employeeId} · ${e.name} · ${e.company} · ${e.status}`));
  $('enrollBtn').onclick=async()=>{
    try{await models();status('กำลังอ่านใบหน้า 3 มุม...','warn',true);
      const descriptors=await Promise.all([extract($('faceFront').files[0],'หน้าตรง'),extract($('faceLeft').files[0],'หันซ้าย'),extract($('faceRight').files[0],'หันขวา')]);
      await runAdmin('enroll',{employeeId:val('enrollId'),descriptors,consentConfirmed:$('consentCheck').checked,consentRecordRef:val('consentRef')});
    }catch(e){status(e.message,'error',true);}
  };
  $('revokeBtn').onclick=()=>{if(confirm('ยืนยันเพิกถอนและลบ Face Profile?'))runAdmin('revokeFace',{employeeId:val('revokeId')});};
  $('scheduleBtn').onclick=()=>runAdmin('saveSchedule',{employeeId:val('scheduleId'),start:val('scheduleStart'),end:val('scheduleEnd')});
  $('refreshSchedules').onclick=()=>runAdmin('schedules',{},r=>itemList('scheduleList',r.schedules,s=>`${s.EmployeeID} · ${s.PlannedStartAt} → ${s.ScheduledEndAt} · ${s.Status}`));
  $('refreshReview').onclick=()=>runAdmin('reviewQueue',{},r=>itemList('reviewList',r.attendance,s=>`${s.EmployeeID} · ${s.SessionID} · IN ${s.CheckInAt} · ${s.ReviewStatus}`));
  $('reviewBtn').onclick=()=>{if(confirm('ยืนยันว่าได้ตรวจสอบเวลา OUT จริงแล้ว?'))runAdmin('resolveMissingOut',{sessionId:val('reviewSession'),outAt:val('reviewOut'),reason:val('reviewReason')});};
}
window.addEventListener('DOMContentLoaded',()=>{bind();setupBridge();});
