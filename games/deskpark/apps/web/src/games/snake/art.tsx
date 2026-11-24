import './art.css';

export function SnakeArt() {
  return <div className="snake-art" aria-hidden="true">
    <span className="snake-art__trail" />
    <span className="snake-art__prism" />
  </div>;
}
