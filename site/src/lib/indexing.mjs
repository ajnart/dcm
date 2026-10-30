const COMPARE = /^\/docs\/changelog\/version\/[^/]+\.\.\.latest$/;

export const isNoindex = (pathname) => {
  const path = pathname.replace(/\.html$/, "");
  return path === "/404" || COMPARE.test(path);
};
