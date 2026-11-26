// The only file of Gousset that imports Tabler (docs/design.md, "Icons"). Every icon the app
// uses is named here, after what it means in Gousset, not after its drawing: changing a drawing,
// the stroke or the whole library touches this file and `icon.tsx` only. Pages draw an icon with
// `<Icon name="import" />` and never import Tabler (a lint rule refuses it).
import {
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowDown,
  IconArrowUp,
  IconArrowsLeftRight,
  IconBabyCarriage,
  IconBarbell,
  IconBolt,
  IconBook,
  IconBuildingBank,
  IconBus,
  IconCalendar,
  IconCar,
  IconCategory,
  IconChartDonut,
  IconChartLine,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconCreditCard,
  IconDeviceGamepad2,
  IconDots,
  IconFileImport,
  IconGasStation,
  IconGift,
  IconHeartbeat,
  IconHome,
  IconHourglass,
  IconInbox,
  IconInfoCircle,
  IconKey,
  IconKeyboard,
  IconLanguage,
  IconListDetails,
  IconLogout,
  IconMinus,
  IconMovie,
  IconPaw,
  IconPencil,
  IconPhone,
  IconPigMoney,
  IconPlane,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconRepeat,
  IconRobot,
  IconSchool,
  IconSearch,
  IconSelector,
  IconSettings,
  IconShirt,
  IconShoppingCart,
  IconSitemap,
  IconSunMoon,
  IconTags,
  IconToolsKitchen2,
  IconTrash,
  IconTrendingDown,
  IconTrendingUp,
  IconUserCircle,
  IconUsers,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import type { Icon as TablerIcon } from "@tabler/icons-react";

/** The interface's icons, by what they do. */
export const interfaceIcons = {
  import: IconFileImport,
  transfer: IconArrowsLeftRight,
  previous: IconChevronLeft,
  next: IconChevronRight,
  expand: IconChevronDown,
  selector: IconSelector,
  close: IconX,
  check: IconCheck,
  add: IconPlus,
  more: IconDots,
  search: IconSearch,
  // The Filters button that a narrow screen folds its filters behind.
  filters: IconAdjustmentsHorizontal,
  calendar: IconCalendar,
  retry: IconRefresh,
  undo: IconArrowBackUp,
  success: IconCircleCheck,
  error: IconAlertCircle,
  warning: IconAlertTriangle,
  info: IconInfoCircle,
  empty: IconInbox,
  up: IconTrendingUp,
  down: IconTrendingDown,
  bank: IconBuildingBank,
  card: IconCreditCard,
  wallet: IconWallet,
  savings: IconPigMoney,
  merchant: IconReceipt,
  // Overlays (menus, dialogs): editing and deleting a line.
  edit: IconPencil,
  delete: IconTrash,
  // A list whose order the user sets (the rules): one place earlier, one later.
  moveUp: IconArrowUp,
  moveDown: IconArrowDown,
  // Money (Delta): a change too small to count.
  steady: IconMinus,
  // The app's screens, in its navigation.
  review: IconChartDonut,
  operations: IconListDetails,
  accounts: IconBuildingBank,
  investments: IconChartLine,
  subjects: IconTags,
  settings: IconSettings,
  rules: IconSitemap,
  // The user's menu.
  user: IconUserCircle,
  users: IconUsers,
  password: IconKey,
  language: IconLanguage,
  colorScheme: IconSunMoon,
  shortcuts: IconKeyboard,
  signOut: IconLogout,
  // An MCP client asking for access, on the consent screen.
  agent: IconRobot,
  // The recurring payments' calendar: a payment that recurs, a credit's last day.
  recurring: IconRepeat,
  expiring: IconHourglass,
} as const;

/**
 * The icons a category may take, in the order they are offered; the user picks among them (no
 * emoji). The name is what is stored with a category, so it is never renamed once released.
 */
export const CATEGORY_ICON_NAMES = [
  "groceries",
  "housing",
  "restaurants",
  "transport",
  "car",
  "fuel",
  "health",
  "sport",
  "travel",
  "pets",
  "leisure",
  "games",
  "subscriptions",
  "phone",
  "energy",
  "clothes",
  "education",
  "books",
  "children",
  "gifts",
  "other",
] as const;

export type CategoryIconName = (typeof CATEGORY_ICON_NAMES)[number];

/** Each category icon's drawing, chosen once here. */
export const categoryIcons = {
  groceries: IconShoppingCart,
  housing: IconHome,
  restaurants: IconToolsKitchen2,
  transport: IconBus,
  car: IconCar,
  fuel: IconGasStation,
  health: IconHeartbeat,
  sport: IconBarbell,
  travel: IconPlane,
  pets: IconPaw,
  leisure: IconMovie,
  games: IconDeviceGamepad2,
  subscriptions: IconRepeat,
  phone: IconPhone,
  energy: IconBolt,
  clothes: IconShirt,
  education: IconSchool,
  books: IconBook,
  children: IconBabyCarriage,
  gifts: IconGift,
  other: IconCategory,
} as const satisfies { [Name in CategoryIconName]: TablerIcon };

export type InterfaceIconName = keyof typeof interfaceIcons;

export type IconName = InterfaceIconName | CategoryIconName;

/** Every icon by its name: what `Icon` draws. */
export const ICONS = { ...interfaceIcons, ...categoryIcons };

/** Whether a stored or typed name is one of Gousset's icons. */
export function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICONS, name);
}

/** The interface's icons, in the order this file declares them. */
export const INTERFACE_ICON_NAMES = Object.keys(interfaceIcons).filter(isIconName);
