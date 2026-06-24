import { Toaster as Sonner } from "sonner";
import { InfoCircle, CheckCircle, CloseCircle, DangerTriangle } from "@solar-icons/react";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      position="top-center"
      className="toaster group"
      icons={{
        info: <InfoCircle weight="Bold" className="h-5 w-5 text-[#FFE500]" />,
        success: <CheckCircle weight="Bold" className="h-5 w-5 text-[#22C55E]" />,
        error: <CloseCircle weight="Bold" className="h-5 w-5 text-[#EF4444]" />,
        warning: <DangerTriangle weight="Bold" className="h-5 w-5 text-[#FFE500]" />,
      }}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "group toast glass-dark !rounded-2xl !text-white !border !border-white/10 !shadow-[0_8px_32px_rgba(0,0,0,0.24)]",
          title: "!text-white !font-medium",
          description: "!text-white/70",
          icon: "!mr-2",
          actionButton: "group-[.toast]:!bg-[#FFE500] group-[.toast]:!text-black",
          cancelButton: "group-[.toast]:!bg-white/10 group-[.toast]:!text-white",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
