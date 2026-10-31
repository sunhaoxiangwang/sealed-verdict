export interface Condition {
  id: string;
  label: string;
  transport: string;
  biasScore: number;
  ci: [number, number];
  accuracy: number;
  herdingFlipRate: number | null;
  byzantineFlipRate: number | null;
  forgedAcceptRate: number | null;
  pVsC0: number | null;
}

export interface Results {
  measured: boolean;
  generatedAt: string | null;
  n: { bbq: number; truthfulqa: number };
  conditions: Condition[];
}
