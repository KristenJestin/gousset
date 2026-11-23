import { m } from "@gousset/i18n/messages";
import { Page, SectionLayout } from "@gousset/ui/components/app-shell";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AppSectionLink } from "@/components/app-link";

/** The settings, in sections (docs/wireframes, `rules` and `categories`). */
export const Route = createFileRoute("/_authed/settings")({
  component: Settings,
});

function Settings() {
  return (
    <Page title={m.settingsTitle()}>
      <SectionLayout
        label={m.settingsTitle()}
        navigation={
          <>
            <AppSectionLink
              to="/settings"
              activeOptions={{ exact: true }}
              label={m.settingsNavGeneral()}
            />
            <AppSectionLink to="/settings/categories" label={m.settingsNavCategories()} />
            <AppSectionLink to="/settings/merchants" label={m.settingsNavMerchants()} />
            <AppSectionLink to="/settings/rules" label={m.settingsNavRules()} />
            <AppSectionLink to="/settings/data" label={m.settingsNavData()} />
          </>
        }
      >
        <Outlet />
      </SectionLayout>
    </Page>
  );
}
