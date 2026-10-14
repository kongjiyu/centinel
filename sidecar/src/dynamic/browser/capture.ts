import type {Page,Locator} from 'playwright';

export class UnsafeVisualObservation extends Error {
 constructor(){super('Sensitive visual observation cannot be safely captured. Exclude this surface and review missing coverage.');this.name='UnsafeVisualObservation';}
}
/** Always mask passwords/declared regions; inspect every frame before writing pixels. */
export async function captureProtectedPage(page:Page,outputPath:string,options:{secrets?:readonly string[];sensitiveSelectors?:readonly string[];signal?:AbortSignal}={}) {
 if(options.signal?.aborted)throw new DOMException('Capture cancelled','AbortError');
 const secrets=options.secrets??[];const masks:Locator[]=[];
 for(const frame of page.frames()){
  // Canvas/video pixels cannot be checked against known values through the DOM.
  if(secrets.length){const opaque=frame.locator('canvas,video');for(let i=0;i<await opaque.count();i++)if(await opaque.nth(i).isVisible())throw new UnsafeVisualObservation();}
  masks.push(frame.locator('input[type="password"], [data-centinel-sensitive], [autocomplete="current-password"], [autocomplete="new-password"]'));
  for(const selector of options.sensitiveSelectors??[]){try{const locator=frame.locator(selector);await locator.count();masks.push(locator);}catch{throw new UnsafeVisualObservation();}}
  for(const secret of [...new Set(secrets.filter(Boolean).flatMap(value=>[value,encodeURIComponent(value),JSON.stringify(value).slice(1,-1)]))]){
   masks.push(frame.getByText(secret,{exact:false}));
   // Visible input values do not belong to textContent.
   const inputs=frame.locator('input,textarea');
   for(let i=0;i<await inputs.count();i++){const input=inputs.nth(i);if((await input.inputValue()).includes(secret))masks.push(input);}
  }
  masks.push(frame.getByText(/https?:\/\/\S+[?#]\S+/, {exact:false}));
 }
 if(options.signal?.aborted)throw new DOMException('Capture cancelled','AbortError');
 await page.screenshot({path:outputPath,fullPage:false,mask:masks,maskColor:'#111827',animations:'disabled',timeout:10_000});
 return {masked:true,opaqueSurfacePolicy:secrets.length?'blocked':'no-seeded-values'} as const;
}
