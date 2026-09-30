export function useAuth(){return {user:{id:'demo',email:'administration@exemple.test',role:'admin',locale:'fr',isPartner:false,personId:null},person:null,loading:false,logout:()=>{location.hash='/app'},login:async()=>{}}}
export const useRequireAuth=useAuth;
