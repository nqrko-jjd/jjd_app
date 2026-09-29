import React, {useSyncExternalStore} from 'react';
function path(){return location.hash.slice(1)||'/app/planning'}
function subscribe(cb:()=>void){window.addEventListener('hashchange',cb);return()=>window.removeEventListener('hashchange',cb)}
export function usePathname(){return useSyncExternalStore(subscribe,path).split('?')[0]}
export function useSearchParams(){const p=useSyncExternalStore(subscribe,path);return new URLSearchParams(p.split('?')[1]||'')}
export function useRouter(){return {push:(p:string)=>{location.hash=p},replace:(p:string)=>{location.hash=p},refresh:()=>location.reload(),back:()=>history.back()}}
export default function Link({href,children,...props}:any){return <a {...props} href={'#'+href}>{children}</a>}
