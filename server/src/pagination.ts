// Pure paging math, kept out of the routes so unit tests can import it without a
// database (like inbound-rules.ts).

/** The rows one page covers, as Prisma's skip/take: page 1 starts at row 0. */
export function pageWindow(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
