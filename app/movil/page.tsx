// Página /movil · convierte un teléfono en una cámara de vigilancia con GPS.
// DUEÑO: constructor B. Se abre desde el QR que la sala de mando enseña al jurado.
import VigilanciaMovil from "@/components/movil/VigilanciaMovil";

export const metadata = {
  title: "Atalaya · Móvil en campo",
  description: "Convierte tu teléfono en una cámara de vigilancia con ubicación para el centro de mando de incendios.",
};

export default function PaginaMovil() {
  return <VigilanciaMovil />;
}
