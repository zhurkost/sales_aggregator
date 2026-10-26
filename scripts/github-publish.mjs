// Repository-scoped publisher. The credential is read into memory, never persisted.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const [operation,tokenFile]=process.argv.slice(2);
if(!['inspect','push'].includes(operation)||!tokenFile)throw new Error('Usage: node scripts/github-publish.mjs inspect|push <token-file>');
const raw=readFileSync(tokenFile,'utf8').trim();
const token=raw.match(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/)?.[0]||raw;
if(!token||/\s/.test(token))throw new Error('Token file must contain one valid GitHub token.');
const repo='zhurkost/sales_aggregator';
const response=await fetch(`https://api.github.com/repos/${repo}`,{headers:{Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'Autopost-project-publisher'}});
if(!response.ok)throw new Error(`GitHub repository access failed: ${response.status}`);
const meta=await response.json();
console.log(JSON.stringify({repository:meta.full_name,defaultBranch:meta.default_branch,private:meta.private,size:meta.size,pushAllowed:meta.permissions?.push}));
if(operation==='inspect')process.exit(0);
const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',GIT_CONFIG_VALUE_0:`AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,GIT_CONFIG_KEY_1:'credential.helper',GIT_CONFIG_VALUE_1:''};
function git(args,allowFailure=false){const r=spawnSync('git',args,{encoding:'utf8',env,windowsHide:true});if(r.error)throw new Error('Unable to run Git.');const output=(r.stdout||'')+(r.stderr||'');console.log(output.replaceAll(token,'[redacted]').trim());if(r.status&&!allowFailure)throw new Error(`Git command failed (${r.status}). No force push attempted.`);return r;}
const remotes=git(['remote']).stdout.split(/\s+/);
const tracked=spawnSync('git',['ls-files','-z'],{encoding:'utf8',windowsHide:true});
if(tracked.status!==0)throw new Error('Cannot inspect tracked files before publishing.');
for(const file of tracked.stdout.split('\0').filter(Boolean)){if(readFileSync(file).includes(Buffer.from(token)))throw new Error(`Credential found in tracked file: ${file}. Publishing stopped.`);}
if(!remotes.includes('github'))git(['remote','add','github',`https://github.com/${repo}.git`]);
const configured=git(['remote','get-url','github']).stdout.trim();if(configured!==`https://github.com/${repo}.git`)throw new Error('Unexpected GitHub remote.');
const refs=git(['ls-remote','github',`refs/heads/${meta.default_branch}`]).stdout.trim();
if(refs){git(['fetch','github',meta.default_branch]);const ancestor=git(['merge-base','--is-ancestor','FETCH_HEAD','HEAD'],true);if(ancestor.status)throw new Error('Remote branch has existing history. Review and merge before publishing.');}
git(['push','github',`HEAD:refs/heads/${meta.default_branch}`]);
const local=git(['rev-parse','HEAD']).stdout.trim();const remote=git(['ls-remote','github',`refs/heads/${meta.default_branch}`]).stdout.split(/\s+/)[0];if(local!==remote)throw new Error('Remote verification mismatch.');console.log(JSON.stringify({published:true,commit:local,url:`https://github.com/${repo}`}));
