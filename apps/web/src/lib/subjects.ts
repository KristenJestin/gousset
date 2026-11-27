import type { SubjectList } from "@gousset/core";

/**
 * Each subject's path, its ancestors' names first ("House > Garden shed"), by its id: the list is
 * in tree order, each parent before its children.
 */
export function pathsOf(subjects: SubjectList["subjects"]): ReadonlyMap<string, string> {
  const paths = new Map<string, string>();

  for (const each of subjects) {
    const parent = each.parentId === null ? undefined : paths.get(each.parentId);

    paths.set(each.id, parent === undefined ? each.name : `${parent} > ${each.name}`);
  }

  return paths;
}

/**
 * The subjects to choose among (#37), in tree order, each by its path: an expense's "+ Add" and a
 * split's shares offer those in use (`inUse`), the operations' filter every one.
 */
export function subjectChoices(
  list: SubjectList | undefined,
  inUse: boolean,
): ReadonlyArray<{ id: string; name: string }> {
  const subjects = list?.subjects ?? [];
  const paths = pathsOf(subjects);

  return subjects.flatMap((each) =>
    inUse && each.archived ? [] : [{ id: each.id, name: paths.get(each.id) ?? each.name }],
  );
}
