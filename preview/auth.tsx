const role=localStorage.getItem('jjd-preview-staff-profile')||'admin';
export function useAuth(){return {user:{id:'demo',email:'administration@exemple.test',role,locale:'fr',isPartner:false,personId:['worker','foreman'].includes(role)?'p0':null},person:['worker','foreman'].includes(role)?{id:'p0',firstName:'José',displayName:'José Démo'}:null,loading:false,logout:()=>{location.hash='/app'},login:async()=>{}}}
export const useRequireAuth=useAuth;
