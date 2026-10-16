import "./Nav.css";

export function SkipLink({ target }: { target: string }) {
  return (
    <a className="skip-link" href={`#${target}`}>
      К содержимому
    </a>
  );
}
