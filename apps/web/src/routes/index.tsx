import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <main>
      <h1>Gousset</h1>
      <p>Nothing works yet.</p>
    </main>
  );
}
