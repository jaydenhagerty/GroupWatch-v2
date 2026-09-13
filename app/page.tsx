'use client';

import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-sky-200/10 bg-gray-800/40 p-12 text-center shadow-2xl shadow-black/20 backdrop-blur">
        <div className="mb-6">
          <h1 className="text-[2em] font-bold text-gray-50">GroupWatch</h1>
          <p className="text-gray-400">React to video clips with your friends!</p>
        </div>
        <div className="mt-4 flex justify-center items-center gap-3">
          <Link
            href="/new-collection"
            className="gw-btn px-5 py-2="
          >
            New Collection
          </Link>
          <Link
            href="/watch"
            className="gw-btn-primary px-5 py-2"
          >
            Watch Party
          </Link>
        </div>
      </div>
    </main>
  );
}
