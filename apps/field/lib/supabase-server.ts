import { serverClient } from '@promold/app-kit/server';
import { supabaseConfig } from './env';

export const supabaseServer = () => serverClient(supabaseConfig());
