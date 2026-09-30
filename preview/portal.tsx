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
export async function portalUpload<T>(_path:string,form:FormData):Promise<T>{const file=form.get('file') as File;return {url:URL.createObjectURL(file),thumbUrl:null} as T;}
