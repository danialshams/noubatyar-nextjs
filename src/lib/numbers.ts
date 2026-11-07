/** Normalize Persian and Arabic-Indic digits in user-entered text without altering other characters. */
export function asciiDigits(value:string):string {
 return value.replace(/[۰-۹٠-٩]/g,ch=>{
   const n=ch.charCodeAt(0);return String(n>=0x06f0&&n<=0x06f9?n-0x06f0:n-0x0660);
 });
}
export function normalizeIranMobile(value:string):string {
 const ascii=asciiDigits(value).trim().replace(/[\s\-()]/g,'');
 return ascii.replace(/^(?:\+?98)/,'0');
}
