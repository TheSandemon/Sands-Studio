import './WindowControls.css'

export default function WindowControls() {
  return (
    <div className="window-controls">
      <button
        className="wc-btn wc-min"
        title="Minimize"
        onClick={() => window.windowAPI.minimize()}
      >
        <span />
      </button>
      <button
        className="wc-btn wc-max"
        title="Maximize"
        onClick={() => window.windowAPI.maximize()}
      >
        <span />
      </button>
      <button
        className="wc-btn wc-close"
        title="Close"
        onClick={() => window.windowAPI.close()}
      >
        <span />
      </button>
    </div>
  )
}
