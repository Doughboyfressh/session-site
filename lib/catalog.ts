export type Track = { id:string; title:string; creator:string; owner?:string; kind:string; genre:string; bpm:number; musicalKey:string; visibility:string; permission:string; fileId?:string; demo?:boolean; color?:string; likes?:number };
export const demos:Track[] = [
{id:'demo-1',title:'AFTER HOURS',creator:'SESSION Originals',kind:'beat',genre:'R&B',bpm:92,musicalKey:'F minor',visibility:'public',permission:'collaborate',demo:true,color:'lime'},
{id:'demo-2',title:'BLUE HOUR',creator:'SESSION Originals',kind:'beat',genre:'Hip-hop',bpm:85,musicalKey:'C minor',visibility:'public',permission:'collaborate',demo:true,color:'blue'},
{id:'demo-3',title:'NO SIGNAL',creator:'SESSION Originals',kind:'beat',genre:'Trap',bpm:140,musicalKey:'D minor',visibility:'public',permission:'collaborate',demo:true,color:'pink'},
{id:'demo-4',title:'SOFT FOCUS',creator:'SESSION Originals',kind:'beat',genre:'Lo-fi',bpm:76,musicalKey:'A minor',visibility:'public',permission:'collaborate',demo:true,color:'amber'}];
export const genres=['All genres','Hip-hop','R&B','Trap','Lo-fi','Pop','Electronic'];
export const defaultPattern=[[1,0,0,0,0,0,1,0,1,0,0,0,0,0,1,0],[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0]];
