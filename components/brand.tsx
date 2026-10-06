import Image from "next/image";

export function Logo({ size = "sidebar" }: { size?: "sidebar" | "auth" }) {
  return (
    <Image
      className={size === "auth" ? "logo logo-auth" : "logo"}
      src="/brand/logo.jpg"
      alt="Elec Novatech PLC. AI solution for smarter businesses."
      width={500}
      height={500}
      priority={size === "auth"}
      style={{ width: "100%", height: "auto" }}
    />
  );
}
