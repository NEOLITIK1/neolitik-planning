// Browser integration against an in-memory Supabase stub: never writes production.
// Starts Vite automatically. Optional CHROMIUM_EXECUTABLE for a preinstalled Chromium.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {buildSchedules} from '../src/scheduler.js';
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:5187';
const server=process.env.TEST_BASE_URL ? null : spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5187'],{stdio:'pipe'});
if(server)for(let attempt=0;attempt<100;attempt++) {
  try{if((await fetch(base)).ok)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
}
const launch={headless:true};
if(process.env.CHROMIUM_EXECUTABLE)Object.assign(launch,{executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
const browser=await chromium.launch(launch);
const ops=Array.from({length:8},(_,i)=>({id:`p${i}`,short:`P${i}`,full:`Prénom P${i}`,active:true,level:i<3?'N4':'N1'}));
const archive={2026:Object.fromEntries(buildSchedules(ops,1,37).schedules.map(({s,matin,am,nuit})=>[s,{matin,am,nuit}]))};
let count=0;
const pass=name=>{count++;console.log(`PASS ${name}`);};
async function setup({failRead=false,people=ops,config={}}={}){
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.addInitScript(()=>{
    const OriginalDate=Date;const fixed=OriginalDate.parse('2026-09-18T10:00:00Z');
    window.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
  });
  const state={ops:structuredClone(people),config:{year:'2026',archive:structuredClone(archive),...structuredClone(config)},writes:[],failWrites:false};
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===new URL(base).origin)return route.continue();
    if(!url.pathname.startsWith('/rest/v1/'))return route.abort();
    if(request.method()==='GET'){
      if(failRead)return route.fulfill({status:503,body:'Unavailable'});
      const data=url.pathname.endsWith('neolitik_operators')?state.ops.map(({id,...data})=>({id,data})):
        [{data:state.config[(url.searchParams.get('key')||'').replace('eq.','')]??null}];
      return route.fulfill({json:data});
    }
    state.writes.push({url:url.pathname,method:request.method()});
    if(state.failWrites)return route.fulfill({status:403,body:'Forbidden'});
    if(request.method()==='POST'){
      const body=request.postDataJSON();
      if(Array.isArray(body))state.ops=body.map(({id,data})=>({id,...data}));
      else state.config[body.key]=body.data;
    }
    return route.fulfill({status:204,body:''});
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(`${base}/?admin=neolitik-admin-2026`);
  return {context,page,state,errors};
}
try {
  const {context,page,state,errors}=await setup();
  await page.getByRole('button',{name:'👥 Équipe',exact:true}).click();
  await page.getByLabel('Niveau de P3',{exact:true}).selectOption('N3');
  await page.waitForFunction(()=>document.body.textContent.includes('Synchronisé'));
  await page.getByLabel('Chef d’équipe P3',{exact:true}).check();
  await page.getByLabel('Chef d’équipe P0',{exact:true}).uncheck();
  await page.getByLabel('Binôme de P4',{exact:true}).selectOption('p5');
  assert.equal(await page.getByLabel('Binôme de P5',{exact:true}).inputValue(),'p4');
  await page.waitForFunction(()=>!document.body.textContent.includes('Enreg...'));
  await page.waitForTimeout(600);
  assert.equal(state.ops[3].level,'N3');assert.equal(state.ops[3].isLeader,true);
  assert.equal(state.ops[0].isLeader,false);assert.equal(state.ops[4].partnerId,'p5');
  pass('Niveau, chef indépendant et binôme symétrique sauvegardés');
  assert.deepEqual(state.config.archive,archive);pass('Archives inchangées après modifications de l’équipe');
  await mkdir('test-output',{recursive:true});
  await page.screenshot({path:'test-output/equipe.png',fullPage:true});
  await page.reload();
  await page.getByRole('button',{name:'👥 Équipe',exact:true}).click();
  assert.equal(await page.getByLabel('Niveau de P3',{exact:true}).inputValue(),'N3');
  assert.equal(await page.getByLabel('Chef d’équipe P0',{exact:true}).isChecked(),false);
  assert.equal(await page.getByLabel('Binôme de P5',{exact:true}).inputValue(),'p4');
  pass('Réouverture : niveaux, rôles et binômes restaurés');
  // Persistent undo/redo uses the same operator schema.
  await page.getByRole('button',{name:'📋 Historique',exact:true}).click();
  await page.getByRole('button',{name:'↩ Annuler',exact:true}).first().click();
  await page.getByRole('button',{name:'👥 Équipe',exact:true}).click();
  assert.equal(await page.getByLabel('Binôme de P4',{exact:true}).inputValue(),'');
  await page.getByRole('button',{name:'📋 Historique',exact:true}).click();
  await page.getByRole('button',{name:/↪ Rétablir/}).first().click();
  await page.getByRole('button',{name:'👥 Équipe',exact:true}).click();
  assert.equal(await page.getByLabel('Binôme de P4',{exact:true}).inputValue(),'p5');pass('Annuler / rétablir le binôme après réouverture');
  // Removing one of only three chiefs makes publication impossible.
  await page.getByLabel('Chef d’équipe P1',{exact:true}).uncheck();
  await page.getByRole('button',{name:'📢 Publier',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Publier',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Annuler',exact:true}).click();pass('Publication bloquée si un chef manque');
  await page.getByLabel('Chef d’équipe P1',{exact:true}).check();
  await page.getByRole('button',{name:'📅 Planning',exact:true}).click();
  await page.screenshot({path:'test-output/planning.png',fullPage:true});
  await page.getByRole('button',{name:'📢 Publier',exact:true}).click();
  await page.getByRole('button',{name:'Publier',exact:true}).click();
  await page.waitForFunction(()=>document.body.textContent.includes('Planning publié'));
  assert.ok(state.config.published_planning?.schedules.length===3);pass('Instantané conforme publié dans le serveur simulé');
  const publicPage=await context.newPage();
  await publicPage.goto(`${base}/?view=planning&token=equipe-neolitik`);
  await publicPage.getByText(/Publié le/).waitFor();
  assert.equal(await publicPage.getByRole('button',{name:'📢 Publier'}).count(),0);pass('Vue publique : instantané lisible et sans commandes admin');
  await page.getByRole('button',{name:'👥 Équipe',exact:true}).click();
  await page.getByLabel('Niveau de P4',{exact:true}).selectOption('N2');
  await page.getByRole('status').filter({hasText:'Modifications non publiées'}).waitFor();pass('Modifications non publiées signalées');
  for(let i=0;i<100&&state.ops[4].level!=='N2';i++)await page.waitForTimeout(20);
  state.failWrites=true;
  await page.getByLabel('Niveau de P4',{exact:true}).selectOption('N3');
  await page.getByRole('alert').filter({hasText:'Sauvegarde incomplète'}).waitFor();
  assert.equal(state.ops[4].level,'N2');
  state.failWrites=false;
  await page.getByRole('button',{name:'Réessayer la sauvegarde'}).click();
  await page.getByRole('alert').filter({hasText:'Sauvegarde incomplète'}).waitFor({state:'hidden'});
  assert.equal(state.ops[4].level,'N3');pass('Erreur HTTP visible et sauvegarde réessayable');
  await page.getByRole('button',{name:'🕐 Heures',exact:true}).click();
  await page.getByText(/Récap mensuel|Heures effectuées|Heures —|Récapitulatif/i).first().waitFor();
  assert.deepEqual(errors,[]);pass('Aucune erreur JavaScript, y compris dans le récapitulatif des heures');
  await page.getByRole('button',{name:'📅 Planning',exact:true}).click();
  await page.getByText('🔒 Affectations à conserver lors du recalcul',{exact:true}).click();
  await page.getByLabel('Semaine du verrouillage').selectOption('38');
  await page.getByLabel('Opérateur à verrouiller').selectOption('p4');
  await page.getByLabel('Poste verrouillé').selectOption('nuit');
  await page.getByRole('button',{name:'Verrouiller',exact:true}).click();
  await page.getByRole('button',{name:'🔄 Recalculer',exact:true}).click();
  await page.reload();
  await page.getByText('🔒 Affectations à conserver lors du recalcul',{exact:true}).click();
  await page.getByRole('button',{name:'Déverrouiller',exact:true}).waitFor();
  assert.equal(state.config.planning_years.years[2026].locks[38].p4,'nuit');
  await page.getByRole('button',{name:'📆 Jours',exact:true}).click();
  await page.getByLabel('Affectations du 2026-09-14').click();
  assert.equal(await page.getByLabel('Poste du jour de P4').inputValue(),'nuit');
  assert.equal(await page.getByLabel('Poste du jour de P5').inputValue(),'nuit');
  await page.getByRole('button',{name:'Annuler',exact:true}).click();
  pass('Verrouillage individuel et binôme conservés après recalcul et rechargement');
  await page.getByLabel('Année du planning').selectOption('2027');
  assert.equal(await page.getByRole('button',{name:'Déverrouiller',exact:true}).count(),0);
  await page.getByLabel('Opérateur absent').selectOption('P7');
  await page.getByLabel('Semaine de l’absence').fill('38');
  await page.getByRole('button',{name:'Ajouter',exact:true}).click();
  await page.getByLabel('Année du planning').selectOption('2026');
  await page.reload();
  await page.getByLabel('Année du planning').waitFor();
  assert.equal(state.config.planning_years.years[2027].absences[38][0],'P7');
  assert.equal(state.config.planning_years.years[2026].absences[38],undefined);
  assert.equal(state.config.planning_years.years[2026].locks[38].p4,'nuit');
  assert.deepEqual(state.config.archive,archive);
  assert.deepEqual(errors,[]);
  pass('Changement d’année : absences, verrouillages et archives restent séparés');
  await context.close();
  const people=[...structuredClone(ops),{id:'p8',short:'P8',full:'Prénom P8',active:true,level:'N4'}];
  const daily=await setup({people,config:{absences:{38:['P0|38|Mar']},overrides:{38:{matin:['P0','P3','P4'],am:['P1','P5'],nuit:['P2','P6','P7']}}}});
  const dp=daily.page;
  await dp.getByRole('button',{name:'📆 Jours',exact:true}).click();
  await dp.getByLabel('Affectations du 2026-09-15').click();
  assert.equal(await dp.getByLabel('Poste du jour de P8').inputValue(),'matin');
  assert.equal(await dp.getByLabel('Poste du jour de P0',{exact:true}).count(),0);
  await dp.getByRole('button',{name:'Annuler',exact:true}).click();
  await dp.getByLabel('Affectations du 2026-09-16').click();
  assert.equal(await dp.getByLabel('Poste du jour de P8').inputValue(),'');
  await dp.getByLabel('Poste du jour de P8').selectOption('matin');
  await dp.getByRole('button',{name:'Enregistrer la journée',exact:true}).click();
  await dp.reload();
  await dp.getByRole('button',{name:'📆 Jours',exact:true}).click();
  await dp.getByLabel('Affectations du 2026-09-16').click();
  assert.equal(await dp.getByLabel('Poste du jour de P8').inputValue(),'matin');
  assert.equal(await dp.getByLabel('Poste du jour de P0',{exact:true}).inputValue(),'');
  assert.deepEqual(Object.keys(daily.state.config.planning_years.years[2026].dailyOverrides),['2026-09-16']);
  await dp.getByRole('button',{name:'Annuler',exact:true}).click();
  await dp.screenshot({path:'test-output/remplacements.png',fullPage:true});
  pass('Remplacement automatique mardi et ajustement manuel mercredi : dates et sauvegarde respectées');
  await dp.getByRole('button',{name:'📢 Publier',exact:true}).click();
  await dp.getByRole('button',{name:'Publier',exact:true}).click();
  await dp.waitForFunction(()=>document.body.textContent.includes('Planning publié'));
  assert.ok(daily.state.config.published_planning.schedules[0].dailySchedules['2026-09-16'].matin.includes('P8'));
  assert.deepEqual(daily.errors,[]);
  pass('Publication : les remplacements journaliers sont présents dans l’instantané');
  await daily.context.close();
  const failure=await setup({failRead:true});
  await failure.page.getByText(/Chargement impossible/).waitFor();
  await failure.page.waitForTimeout(800);
  assert.equal(failure.state.writes.length,0);pass('Échec de chargement : aucune écriture des valeurs par défaut');
  await failure.context.close();
  console.log(`${count} scénarios navigateur réussis.`);
} finally {await browser.close();server?.kill();}
