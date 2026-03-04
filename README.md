# RekPDF - PDF Dizgi Sistemi

React + TypeScript + Tailwind CSS ile geliştirilmiş PDF dizgi ve analiz sistemi.

## Teknolojiler

- **React 19** - UI kütüphanesi
- **TypeScript** - Tip güvenliği
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **React Router DOM** - Routing

## Kurulum

```bash
npm install
```

## Geliştirme

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Proje Yapısı

```
src/
  ├── components/     # React bileşenleri
  │   └── Header.tsx  # Header bileşeni
  ├── contexts/       # Context API
  │   └── AuthContext.tsx  # Authentication context
  ├── App.tsx         # Ana uygulama
  └── main.tsx        # Entry point
```

## Özellikler

- ✅ Authentication sistemi (localStorage tabanlı)
- ✅ Responsive header bileşeni
- ✅ React Router ile sayfa yönlendirme
- ✅ Tailwind CSS ile modern tasarım

## Notlar

- Logo dosyası (`rbdlogo.png`) `public/` klasörüne eklenmelidir.
- Authentication şu anda localStorage kullanıyor, production için backend entegrasyonu gerekebilir.
