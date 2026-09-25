import Link from "next/link";

export default function ProductHeader({ active }: { active?: "home" | "console" | "demo" }) {
  return (
    <header className="product-header shell">
      <Link className="brand" href="/" aria-label="CellFlow home">
        <span className="brand-mark" aria-hidden="true">CF</span>
        <span>CellFlow</span>
        <small>v0.3</small>
      </Link>
      <nav className="product-nav" aria-label="Primary navigation">
        <Link className={active === "home" ? "active" : ""} href="/">Overview</Link>
        <Link className={active === "console" ? "active" : ""} href="/console">Console</Link>
        <Link className={active === "demo" ? "active" : ""} href="/demo">Demo</Link>
      </nav>
      <Link className="header-cta" href="/console">Open console <span aria-hidden="true">→</span></Link>
    </header>
  );
}
