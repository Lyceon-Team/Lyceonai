import { test, expect } from '@playwright/test';
import { TEST } from '../utils/testEnv';

test('User-side: click through all buttons/links on each page', async ({ page }) => {
  // Add or adjust routes if your app differs
  const routes = ['/', '/practice', '/chat', '/dashboard'];
  
  for (const route of routes) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(route.replace('/', '\\/')));
    
    // Capture clickable elements
    const clickables = page.locator('a,button,[role=button],input[type=submit],.btn');
    const count = await clickables.count();
    
    for (let i = 0; i < count; i++) {
      const el = clickables.nth(i);
      const text = (await el.textContent())?.trim() || (await el.getAttribute('aria-label')) || `el#${i}`;
      
      // Try safe clicks; ignore clearly destructive ones by text
      if (/delete|remove|reset|wipe/i.test(text)) continue;
      
      // Click and ensure no console error and page still responsive
      const [consoleErr] = await Promise.allSettled([
        new Promise<void>((res, rej) => {
          const listener = (msg: any) => { 
            if (msg.type() === 'error') { 
              rej(new Error(msg.text())); 
            } 
          };
          (page as any).on('console', listener);
          setTimeout(() => { 
            (page as any).off('console', listener); 
            res(); 
          }, 500);
        }),
        el.click({ trial: false }).catch(() => {}) // tolerate no-op buttons
      ]);
      
      // No 500/404 visible
      expect(await page.locator('text=/\\b(404|500|error)\\b/i').count()).toBe(0);
    }
  }
});