import { deleteExpiredWorkerData } from "@/lib/privacy/retention";

deleteExpiredWorkerData()
  .then((result) => {
    console.log(
      `Deleted ${result.conversations} conversation(s) and ${result.contractReviews} contract review(s) older than ${result.cutoff.toISOString()}.`,
    );
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
