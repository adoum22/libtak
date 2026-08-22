export const MOBILE_DIRECT_ITEM_LIMIT = 4;

export const getPrimaryMobilePaths = (isAdmin: boolean) => (
  isAdmin
    ? ['/', '/cash-register', '/pos', '/inventory']
    : ['/pos', '/credit', '/inventory', '/accounting']
);
