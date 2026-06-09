import { BookOpen } from "lucide-react";
// if you'd like to use the actual image file that was attached,
// drop it under src/assets/logo.png and uncomment the import below.
// Vite will bundle it correctly. The component will automatically
// render the image if present.
// import logoImg from "../assets/logo.png";

function ReGuideLogo({ size = "lg" }) {
  const dimension = size === "lg" ? 56 : 36; // px
  const radius = size === "lg" ? 16 : 8;
  const iconSize = size === "lg" ? 32 : 20;

  const containerStyle = {
    width: `${dimension}px`,
    height: `${dimension}px`,
    borderRadius: `${radius}px`,
    backgroundColor: "#4facfe",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <div style={containerStyle}>
      {/* show graphic if file exists otherwise fall back to icon */}
      {/* {logoImg ? (
        <img src={logoImg} alt="ReGuide" style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          borderRadius: `${radius}px",
        }} />
      ) : ( */}
      <BookOpen size={iconSize} color="white" />
      {/* )} */}
    </div>
  );
}

export default ReGuideLogo;
