import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseAnonKey } from '../../config.js';
/** Evidence transfers have their own bounded fetch; other features retain their HTTP contract. */
export function evidenceStorageClient(accessToken: string) {
    const url = getSupabaseUrl(), key = getSupabaseAnonKey();
    if (!url || !key)
        throw Error('Supabase unavailable');
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: 'Bearer ' + accessToken }, fetch: (input, init) => {const headers=new Headers(init?.headers);headers.set('Authorization','Bearer '+accessToken);headers.set('apikey',key);headers.set('Cache-Control','no-cache');return fetch(input, { ...init,headers,cache:'no-store', signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });} } });
}
