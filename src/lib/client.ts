export async function api<T=any>(url:string,options?:RequestInit):Promise<T>{
  const res=await fetch(url,{credentials:"same-origin",...options,headers:{...(options?.body?{"Content-Type":"application/json"}:{}),...options?.headers}});
  const json=await res.json().catch(()=>({}));if(!res.ok)throw new Error(json.error||"درخواست ناموفق بود");return json as T;
}
export const post=<T=any>(url:string,body:unknown)=>api<T>(url,{method:"POST",body:JSON.stringify(body)});
export const patch=<T=any>(url:string,body:unknown)=>api<T>(url,{method:"PATCH",body:JSON.stringify(body)});
