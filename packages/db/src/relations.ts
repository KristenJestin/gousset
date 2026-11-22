import { defineRelations } from "drizzle-orm";

import { authRelations, tables } from "./schema";

export const relations = {
  ...defineRelations(tables),
  ...authRelations,
};
