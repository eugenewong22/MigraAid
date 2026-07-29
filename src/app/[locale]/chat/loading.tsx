/**
 * Shown while a page is being rendered on the server.
 *
 * The locale layout is `force-dynamic` for the nonce CSP, so nothing in the
 * worker-facing app is prerendered — every navigation is a server round trip.
 * On a slow connection that meant the previous page simply sat there until the
 * new one arrived, which is indistinguishable from a tap that did not register.
 *
 * Deliberately structural rather than a spinner: blocks in roughly the shape of
 * the page that is coming reads as "loading" without claiming to know how long
 * it will take.
 */
export default function Loading() {
  return (
    <div
      // The route announces itself when it arrives; a skeleton is decoration.
      aria-hidden="true"
      className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-5 py-10 md:px-12"
    >
      <div className="h-8 w-2/3 rounded-lg bg-sand" />
      <div className="h-4 w-full rounded bg-sand" />
      <div className="h-4 w-5/6 rounded bg-sand" />
      <div className="h-4 w-4/6 rounded bg-sand" />
      <div className="mt-4 h-24 w-full rounded-xl bg-sand" />
    </div>
  );
}
