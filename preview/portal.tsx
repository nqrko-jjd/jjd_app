import React from 'react';
import {api} from './api';
import {useApi} from '../apps/web/src/lib/use-api';
const promoter=localStorage.getItem('jjd-preview-client-profile')==='promoter';
const me={email:'client@example.test',label:promoter?'Promoteur Démo':'Syndic Démo',isSyndic:!promoter,isPromoter:promoter,access:'full',scopeLabel:null,scope:promoter?'promoter':'syndic'};
export const portalApi=<T,>(path:string,opts:any={})=>api<T>('/preview-portal'+path,opts);
export function usePortal(){return {me,loading:false,signOut:()=>{location.hash='/app'}}}
export const usePortalGuard=usePortal;
export function usePortalApi<T>(path:string|null){return useApi<T>(path?'/preview-portal'+path:null)}
export function PortalProvider({children}:{children:React.ReactNode}){return <>{children}</>}
export const setPortalToken=()=>{};
export async function portalBlobUrl(){throw Error('Aucun PDF réel dans cet aperçu.');}
export async function portalUpload<T>(path:string,form:FormData):Promise<T>{
 const file=form.get('file');if(!(file instanceof File))throw Error('Choisissez un fichier.');
 if(file.size>2*1024*1024)throw Error('Dans la maquette, choisissez un fichier de moins de 2 Mo.');
 const pdf=path.endsWith('/attachments');if(pdf?file.type!=='application/pdf':!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw Error('Format non accepté.');
 const url=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Lecture du fichier impossible.'));reader.readAsDataURL(file);});
 return (pdf?{url,name:file.name,mime:'application/pdf'}:{url,thumbUrl:null}) as T;
}
