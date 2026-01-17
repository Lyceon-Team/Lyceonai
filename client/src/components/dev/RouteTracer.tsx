import { useEffect } from 'react';

export default function RouteTracer({ name }: { name: string }) {
  useEffect(() => {
    console.log(`[ROUTE] Entered: ${name}`);
  }, [name]);
  return null;
}
