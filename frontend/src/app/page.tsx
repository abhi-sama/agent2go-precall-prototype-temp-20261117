import { redirect } from "next/navigation"

/** Roots land on the default (MSL) workspace; the client then follows the stored persona. */
export default function Home() {
  redirect("/msl")
}
