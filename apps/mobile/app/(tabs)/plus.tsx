import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text } from '@/lib/AppText';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSession } from '@/lib/session';
import { T } from '@/lib/theme';
import { ScreenHeader } from '@/lib/ui';

type LinkItem={href:string;label:string;description:string;ic:keyof typeof Feather.glyphMap;roles?:string[]};
const OFFICE=['admin','office'];
const TEAM=['admin','office','foreman'];
const STOCK=['admin','office','foreman','storekeeper'];
const GROUPS:{title:string;links:LinkItem[]}[]=[
 {title:'Mon quotidien',links:[
  {href:'/planning',label:'Planning',description:'Mes journées et affectations',ic:'calendar',roles:['worker','foreman','admin','office']},
  {href:'/valider',label:'À valider',description:'Rapports et pointages de l’équipe',ic:'check-square',roles:TEAM},
  {href:'/heures',label:'Mes heures',description:'Mes pointages sur chantier',ic:'clock',roles:['worker','foreman']},
  {href:'/compte',label:'Mon compte',description:'Profil, langue et préférences',ic:'user'},
 ]},
 {title:'Magasin',links:[
  {href:'/scan',label:'Scanner',description:'Un code : l’article, son stock, entrée ou sortie',ic:'maximize',roles:STOCK},
  {href:'/preparations',label:'Préparations',description:'Le matériel à préparer pour les chantiers',ic:'package',roles:STOCK},
  {href:'/articles',label:'Articles',description:'Le stock du magasin et les alertes',ic:'search',roles:[...STOCK,'worker']},
 ]},
 {title:'Chantiers & ressources',links:[
  {href:'/immeubles',label:'Immeubles & projets',description:'Les dossiers regroupés par bâtiment',ic:'home',roles:TEAM},
  {href:'/contacts',label:'Contacts',description:'Clients et interlocuteurs',ic:'book-open',roles:TEAM},
  {href:'/equipe',label:'Équipe',description:'Les personnes et leurs coordonnées',ic:'users',roles:TEAM},
  {href:'/flotte',label:'Flotte',description:'Véhicules et entretiens',ic:'truck',roles:TEAM},
 ]},
 {title:'Gestion',links:[
  {href:'/pipeline',label:'Opportunités',description:'Les demandes à suivre',ic:'trending-up',roles:OFFICE},
  {href:'/documents',label:'Devis & factures',description:'Documents et paiements',ic:'file-text',roles:OFFICE},
  {href:'/achats',label:'Achats & dépenses',description:'Justificatifs et coûts',ic:'shopping-bag',roles:OFFICE},
  {href:'/decomptes',label:'Décomptes du mois',description:'Les journées à contrôler',ic:'credit-card',roles:TEAM},
  {href:'/analyse',label:'Analyse',description:'Facturé, encaissé, marges et devis',ic:'bar-chart-2',roles:OFFICE},
  {href:'/controle',label:'File de contrôle',description:'Les informations à vérifier',ic:'flag',roles:OFFICE},
 ]},
];
const ROLE:Record<string,string>={admin:'Administration',office:'Bureau',foreman:'Chef de chantier',worker:'Ouvrier',storekeeper:'Magasinier'};
export default function Plus(){
 const router=useRouter();const {user,person,signOut}=useSession();
 const name=person?.displayName||person?.firstName||user?.email?.split('@')[0]||'Mon espace';
 return <ScrollView style={{flex:1,backgroundColor:T.paper}} contentContainerStyle={{...T.content,gap:24}}>
  <ScreenHeader title="Mon espace" eyebrow={ROLE[user?.role??'']??'JJD Consult'} description="Tout ce dont vous avez besoin, au même endroit."/>
  <View style={s.identity}><View style={s.avatar}><Text style={s.initials}>{name.slice(0,2).toUpperCase()}</Text></View><View style={{flex:1,gap:4}}><Text style={s.name}>{name}</Text><Text style={s.email}>{user?.email}</Text></View></View>
  {GROUPS.map(group=>{const links=group.links.filter(l=>!l.roles||l.roles.includes(user?.role??''));if(!links.length)return null;return <View key={group.title} style={{gap:12}}><Text style={s.section}>{group.title}</Text><View style={s.group}>{links.map((l,i)=><Pressable key={l.href} accessibilityRole="button" style={({pressed})=>[s.row,i>0&&s.border,pressed&&{backgroundColor:T.primarySoft}]} onPress={()=>router.push(l.href as never)}><View style={s.icon}><Feather name={l.ic} size={20} color={T.primary}/></View><View style={{flex:1,gap:4}}><Text style={s.label}>{l.label}</Text><Text style={s.description}>{l.description}</Text></View><Feather name="chevron-right" size={18} color={T.ink3}/></Pressable>)}</View></View>})}
  <Pressable accessibilityRole="button" style={s.logout} onPress={signOut}><Feather name="log-out" size={18} color={T.crit}/><Text style={{color:T.crit,fontWeight:'600'}}>Se déconnecter</Text></Pressable>
 </ScrollView>;
}
const s=StyleSheet.create({
 identity:{backgroundColor:T.primary,borderRadius:22,padding:22,flexDirection:'row',alignItems:'center',gap:16},avatar:{width:50,height:50,borderRadius:17,backgroundColor:'#ffffff18',alignItems:'center',justifyContent:'center'},initials:{color:T.gold,fontSize:19,fontWeight:'800'},name:{fontSize:19,fontWeight:'700',color:'white'},email:{color:'#d0dfd5',fontSize:12},section:{fontSize:11,fontWeight:'700',letterSpacing:1.1,textTransform:'uppercase',color:T.ink2},group:{...T.shadow,backgroundColor:T.surface,borderRadius:20,borderWidth:1,borderColor:T.line,overflow:'hidden'},row:{flexDirection:'row',alignItems:'center',padding:18,gap:14,minHeight:78},border:{borderTopWidth:1,borderTopColor:T.line},icon:{width:42,height:42,borderRadius:14,backgroundColor:T.primarySoft,alignItems:'center',justifyContent:'center'},label:{fontWeight:'700',color:T.ink,fontSize:14},description:{fontSize:12,color:T.ink2,lineHeight:17},logout:{padding:18,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,borderRadius:16,backgroundColor:T.surface,borderWidth:1,borderColor:T.line}
});
