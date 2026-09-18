import {runAnnualDaily} from './annual-daily.js';
import {runRegression} from './regression.js';
import {runRules} from './rules.js';
import {runPayroll} from './payroll.js';
const start=performance.now();
const results=[...runRegression(),...runRules(),...runPayroll(),...runAnnualDaily()];
for(const r of results.filter(r=>!r.pass))console.error('FAIL',r.name,'—',r.detail);
console.log(`${results.filter(r=>r.pass).length}/${results.length} assertions passed (${Math.round(performance.now()-start)} ms)`);
process.exitCode=results.some(r=>!r.pass)?1:0;
