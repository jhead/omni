import { useStdout } from "ink";
import { useEffect, useState } from "react";

/** Terminal dimensions in character cells; updates on SIGWINCH / resize. */
export function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState(() =>
    stdout.columns !== undefined && stdout.columns > 0 ? stdout.columns : 80,
  );
  const [rows, setRows] = useState(() =>
    stdout.rows !== undefined && stdout.rows > 0 ? stdout.rows : 24,
  );

  useEffect(() => {
    const sync = () => {
      const c = stdout.columns;
      const r = stdout.rows;
      if (c !== undefined && c > 0) setColumns(c);
      if (r !== undefined && r > 0) setRows(r);
    };
    sync();
    stdout.on("resize", sync);
    return () => {
      stdout.off("resize", sync);
    };
  }, [stdout]);

  return { columns, rows };
}
