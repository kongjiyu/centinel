type ViewSettings = { palette?: string };
type Painter = { paint(options: { palette: string }): string };

const FALLBACK_PALETTE = "paper";

export function drawView(settings: ViewSettings, painter: Painter): string {
  const chosen = settings.palette ?? FALLBACK_PALETTE;
  return painter.paint({ palette: chosen });
}
