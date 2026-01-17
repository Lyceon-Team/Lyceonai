export class StageTimer {
  private t0 = new Map<string, number>();
  private times: Record<string, number> = {};
  
  start(stage: string) { 
    this.t0.set(stage, Date.now()); 
  }
  
  end(stage: string) { 
    const t = this.t0.get(stage); 
    if (t) this.times[stage] = Date.now() - t; 
  }
  
  get() { 
    return this.times; 
  }
}