"use client";

import { useRouter } from "next/navigation";
import { ImageUploader } from "@/components/ui/image-uploader";
import { uploadAvatar, deleteAvatar } from "@/lib/actions/profile";

interface Props {
  currentUrl: string | null;
}

export function AvatarUploader({ currentUrl }: Props) {
  const router = useRouter();
  return (
    <div className="max-w-md mx-auto">
      <ImageUploader
        currentUrl={currentUrl}
        uploadAction={uploadAvatar}
        deleteAction={deleteAvatar}
        maxSizeMB={2}
        acceptedTypes={["image/jpeg", "image/png", "image/webp"]}
        previewSize={144}
        shape="circle"
        placeholderText="Arrastrá una imagen o hacé click para subir tu avatar"
        onUploaded={() => router.refresh()}
      />
    </div>
  );
}
