import type { ChartPoint, ChartState } from "./types";

export const chartState: ChartState = {
  hoverIndex: null,
  points: [],
};

export function createChartState(): ChartState {
  return { hoverIndex: null, points: [] };
}
