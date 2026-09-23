// Каркас главной страницы. Интерфейс разговора и панель трассировки строятся в #4.
export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <h1>Voice Router</h1>
      <p>Каркас приложения запущен. Состояние сервиса и базы данных: /api/health</p>
    </main>
  );
}
