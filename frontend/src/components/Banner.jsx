// Full-width band under the top bar (BRIEF §7 Banner). Critical banners are
// announced as alerts and cannot be dismissed while their condition holds.

export default function Banner({ tone = 'info', children, action }) {
  return (
    <div className={`banner banner--${tone}`} role={tone === 'critical' ? 'alert' : 'status'}>
      <span className="banner__text">{children}</span>
      {action}
    </div>
  );
}
