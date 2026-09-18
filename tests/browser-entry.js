import {runAnnualDaily} from './annual-daily.js';
import {runRegression} from './regression.js';
import {runRules} from './rules.js';
import {runPayroll} from './payroll.js';
const results=[...runRegression(),...runRules(),...runPayroll(),...runAnnualDaily()];
const container=document.getElementById('results');
for(const result of results){
  const row=document.createElement('div');
  row.className=`test ${result.pass?'pass':'fail'}`;
  row.textContent=`${result.pass?'✅':'❌'} ${result.name}${result.pass?'':` — ${result.detail}`}`;
  container.append(row);
}
document.getElementById('summary').textContent=`${results.filter(r=>r.pass).length}/${results.length} contrôles réussis`;
window.testResults=results;
